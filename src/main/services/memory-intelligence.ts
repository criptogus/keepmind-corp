import type { AiProviderConfig } from '../store'
import { existsSync, readdirSync } from 'node:fs'
import type { Memory } from './brain/memory-store'
import { chat, completionIdentity, type ChatMessage, type LlmResponse } from './llm'
import type { EgressContext } from './security/egress'
import { createProjectAnalysisService } from './project-analysis'
import { runAnswerBenchmark, validateBenchmarkReport, type BenchmarkReport } from './answer-benchmark'
import { assertNoSymlinkPath, type AnalysisArgs } from '../../../tools/lib/continuity.mjs'

interface Configuration { ai: AiProviderConfig; localModelId?: string }
export interface IntelligenceDependencies {
  configuration(): Configuration
  localEndpoint?(): string | undefined
  ensureLocal?(modelId?: string, signal?: AbortSignal): Promise<unknown>
  complete?(ai: AiProviderConfig, messages: ChatMessage[], endpoint: string | undefined, egress: EgressContext, signal: AbortSignal): Promise<LlmResponse>
  onBenchmarkProgress?(progress: { completed: number; total: number; calls: number; space: string }): void
}
const REPORT_DIR = 'ops/answer-benchmarks'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error('Operation cancelled'))
    signal.addEventListener('abort', aborted, { once: true })
    // Attach both handlers even when already cancelled: shared model startup
    // may finish later, and must not leave an unhandled rejection.
    operation.then(value => { signal.removeEventListener('abort', aborted); resolve(value) },
      error => { signal.removeEventListener('abort', aborted); reject(error) })
    if (signal.aborted) aborted()
  })
}

/** Native composition boundary: provider credentials never reach renderer or reports. */
export class MemoryIntelligence {
  private benchmarks = new Map<string, AbortController>()
  private analyses = new Set<string>()

  constructor(private memory: Memory, private dependencies: IntelligenceDependencies) {}

  private snapshot(): Configuration {
    const config = this.dependencies.configuration()
    return { ai: { ...config.ai }, localModelId: config.localModelId }
  }

  private async ready(config: Configuration, signal: AbortSignal) {
    signal.throwIfAborted()
    if (config.ai.provider === 'local') {
      if (!this.dependencies.ensureLocal) throw new Error('LOCAL_MODEL_UNAVAILABLE')
      await untilAborted(this.dependencies.ensureLocal(config.localModelId, signal), signal)
    }
  }

  private identity(config: Configuration) {
    const identity = completionIdentity(config.ai)
    if (config.ai.provider === 'local' && config.localModelId) identity.model = config.localModelId
    return identity
  }

  private async complete(config: Configuration, system: string, user: string, egress: EgressContext, signal: AbortSignal) {
    signal.throwIfAborted()
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }]
    const endpoint = this.dependencies.localEndpoint?.()
    const response = await untilAborted(this.dependencies.complete
      ? this.dependencies.complete(config.ai, messages, endpoint, egress, requestSignal)
      : chat(config.ai, messages, [], endpoint, egress, requestSignal), requestSignal)
    requestSignal.throwIfAborted()
    if (response.toolCalls?.length) throw new Error('ANALYSIS_TOOL_CALL_DENIED')
    return response.text
  }

  projectAnalyze(args: Omit<AnalysisArgs, 'signal'>) {
    return this.memory.withScope(async () => {
      const key = `${this.memory.currentSpace}/${args.projectId}`
      if (this.analyses.has(key)) throw new Error('PROJECT_ANALYSIS_BUSY')
      this.analyses.add(key)
      try {
        const config = this.snapshot()
        const signal = AbortSignal.timeout(180_000)
        await this.ready(config, signal)
        const service = createProjectAnalysisService(this.memory, request => this.complete(
          config, request.system, request.user,
          { space: this.memory.currentSpace, spaces: [this.memory.currentSpace], class: this.memory.classificationFloor },
          signal
        ), this.identity(config))
        return await service.analyze({ ...args, signal })
      } finally { this.analyses.delete(key) }
    })
  }

  runBenchmark(): Promise<BenchmarkReport> {
    return this.memory.withScope(async () => {
      const space = this.memory.currentSpace
      if (this.benchmarks.has(space)) throw new Error('BENCHMARK_BUSY')
      const controller = new AbortController()
      this.benchmarks.set(space, controller)
      try {
        const config = this.snapshot()
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)])
        try { await this.ready(config, signal) }
        catch (error) { if (!signal.aborted) throw error }
        const report = await runAnswerBenchmark({
          ...this.identity(config), signal,
          complete: request => this.complete(config, request.system, request.user,
            // Only the synthetic suite and generated answers enter this callback.
            { space, spaces: [space], class: 'internal' }, signal),
          onProgress: progress => this.dependencies.onBenchmarkProgress?.({ ...progress, space })
        })
        validateBenchmarkReport(report)
        // JSON records stay outside Markdown recall and Git memory ingestion:
        // synthetic benchmark facts must never become user knowledge.
        const path = this.memory.scopePath(`${REPORT_DIR}/${report.id}.json`)
        assertNoSymlinkPath(this.memory.resolve('.'), path)
        this.memory.write(path, JSON.stringify(report, null, 2))
        return report
      } finally { this.benchmarks.delete(space) }
    })
  }

  cancelBenchmark(): boolean {
    const active = this.benchmarks.get(this.memory.currentSpace)
    if (!active) return false
    active.abort()
    return true
  }

  listBenchmarks(): BenchmarkReport[] {
    return this.memory.withScope(() => {
      const dir = this.memory.scopePath(REPORT_DIR)
      assertNoSymlinkPath(this.memory.resolve('.'), dir)
      if (!existsSync(this.memory.resolve(dir))) return []
      const files = readdirSync(this.memory.resolve(dir), { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json') && UUID.test(entry.name.slice(0, -5)))
        .map(entry => entry.name)
        .map(file => ({ file, modified: this.memory.fileMtime(`${dir}/${file}`) ?? 0 }))
        .filter(item => item.modified > 0).sort((a, b) => b.modified - a.modified).slice(0, 20)
      return files.map(({ file }) => {
        const path = `${dir}/${file}`
        assertNoSymlinkPath(this.memory.resolve('.'), path)
        const raw = this.memory.read(path)
        if (raw === null || Buffer.byteLength(raw, 'utf8') > 1_048_576) throw new Error('BENCHMARK_RECORD_UNAVAILABLE')
        let value: unknown
        try { value = JSON.parse(raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')) }
        catch { throw new Error('BENCHMARK_RECORD_INVALID') }
        validateBenchmarkReport(value)
        if (value.id !== file.slice(0, -5)) throw new Error('BENCHMARK_RECORD_INVALID')
        return value
      })
    })
  }
}
