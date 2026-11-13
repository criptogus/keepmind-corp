import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { policy } from '../security/classification'

import { chat, type ChatMessage } from '../llm'
import type { AiProviderConfig } from '../../store'
import type { McpManager } from '../mcp'
import type { LocalLlm } from '../local-llm'

import * as github from '../github'
import type { Store } from '../../store'
import type { GitSync } from '../sync'
import type { RagService } from '../rag'
import type { LayaService } from '../laya'

import { acceptProposal, activeForPrompt, addActive, addProposal, compactLegacy, discardProposal, factById, factsAsOf, monthLabel, parseAsOf, proposalsOf, readFacts, type FactOrigin } from '../facts'
import { addEvalQuestion, readEval, scoreEval } from '../evalset'
import { formatFactSelection, labelMemorySource } from '../../../../tools/lib/memory-contract.mjs'
import { createContinuityService } from '../continuity'
import type { ContinuityActor } from '../../../../tools/lib/continuity.mjs'

import { Memory } from './memory-store'
import { slug } from './utils'

export interface LedgerEntry {
  ts: string | number
  verb: 'processed' | 'discovered' | 'improved' | 'needs-you'
  sentence: string
  path?: string
}

export interface ChatResult {
  text: string
  memories: string[]
  saved: string[]
  steps: string[]
}

export interface JobEvent {
  phase: 'start' | 'done' | 'error'
  name: string
  summary?: string
}

export class BrainRuntime {
  protected memory: Memory

  protected store: Store

  protected mcp: McpManager | null = null

  protected localLlm: LocalLlm | null = null

  protected gitSync: GitSync | null = null

  protected rag: RagService | null = null

  protected laya: LayaService | null = null

  constructor(store: Store, mcp: McpManager | null, localLlm: LocalLlm | null = null) {
    this.store = store
    this.mcp = mcp
    this.localLlm = localLlm
    this.memory = new Memory(store.memoryDir, () => store.get().github)
  }

  setMcp(mcp: McpManager) { this.mcp = mcp }

  setLocalLlm(l: LocalLlm) { this.localLlm = l }

  async ensureProviderReady(): Promise<void> {
    const cfg = this.store.get()
    if (cfg.ai.provider !== 'local' || !this.localLlm) return
    try {
      await this.localLlm.ensureRunning(cfg.localLlm.modelId)
    } catch (e) {
      console.warn('[brain] local provider not ready:', e)
    }
  }

  attachSync(sync: GitSync) {
    this.gitSync = sync
    this.memory.onWrite = (rel) => sync.markDirty(rel)
  }

  setRag(rag: RagService) { this.rag = rag }

  setLaya(l: LayaService) { this.laya = l }

  onJob: ((event: JobEvent) => void) | null = null

  protected turnSaved: string[] = []

  protected quarantined = false

  setQuarantine(on: boolean) { this.quarantined = on }

  getMemory() { return this.memory }

  continuity(action: string, args: Record<string, unknown> = {}, actor: ContinuityActor = 'agent') {
    return this.memory.withScope(() => createContinuityService(this.memory).dispatch(action, args, actor))
  }

  note(verb: LedgerEntry['verb'], sentence: string, path?: string) {
    const entry: LedgerEntry = { ts: new Date().toISOString(), verb, sentence, path }
    this.memory.appendJsonl('ledger.jsonl', entry)
  }

  ledger(limit = 40): LedgerEntry[] {
    return this.memory.readJsonl('ledger.jsonl', limit) as LedgerEntry[]
  }

  protected emitJob(event: JobEvent) {
    try { this.onJob?.(event) } catch { /* renderer gone */ }
  }

  setActivitySource(src: string) { this.memory.activitySource = src }

  protected recentTurns(maxPairs = 6): ChatMessage[] {
    const today = new Date().toISOString().slice(0, 10)
    const raw = this.memory.read(this.memory.scopePath(`short-term/${today}.md`)) ?? ''
    const chunks = raw.split(/\n## /).slice(-maxPairs)
    const msgs: ChatMessage[] = []
    for (const chunk of chunks) {
      const m = chunk.match(/\*\*You:\*\*\s*([\s\S]*?)\n\n\*\*[^*]+:\*\*\s*([\s\S]*)$/)
      if (!m) continue
      const user = m[1].trim().slice(0, 2000)
      const assistant = m[2].trim().slice(0, 2000)
      if (!user || !assistant) continue
      msgs.push({ role: 'user', content: user }, { role: 'assistant', content: assistant })
    }
    return msgs
  }

  protected recentVaultNotes(days = 14, cap = 200) {
    const cutoff = Date.now() - days * 864e5
    const recent: { path: string; title: string; dir: string; mtime: number }[] = []
    for (const f of this.memory.allRelFiles()) {
      if (!f.endsWith('.md')) continue
      if (f.split('/').slice(0, -1).some(s => s.startsWith('.'))) continue
      const mt = this.memory.fileMtime(this.memory.scopePath(f))
      if (mt == null || mt < cutoff) continue
      recent.push({ path: f, title: '', dir: f.split('/')[0] ?? '', mtime: mt })
    }
    recent.sort((a, b) => b.mtime - a.mtime)
    for (const n of recent.slice(0, cap)) {
      const c = this.memory.read(this.memory.scopePath(n.path))
      n.title = c?.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? n.path.split('/').pop()!.replace(/\.md$/, '')
    }
    return recent.slice(0, cap)
  }

  protected scriptedInsights(): string[] {
    const today = new Date().toISOString().slice(0, 10)
    const lines: string[] = []

    // tasks: parse meta lines for due dates
    const open: { title: string; due?: string; priority?: string }[] = []
    for (const f of this.memory.list(this.memory.scopePath('tasks'))) {
      const c = this.memory.read(this.memory.scopePath(`tasks/${f}`)) ?? ''
      const title = c.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.replace('.md', '')
      const meta = c.match(/^>\s*(.+)$/m)?.[1] ?? ''
      if (/status:\s*done/i.test(meta)) continue
      const due = meta.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1]
      const priority = meta.match(/priority:\s*(\w+)/i)?.[1]?.toLowerCase()
      open.push({ title, due, priority })
    }
    const overdue = open.filter(t => t.due && t.due < today)
    const dueToday = open.filter(t => t.due === today)
    if (overdue.length) lines.push(`⏰ ${overdue.length} task(s) overdue — oldest: "${overdue.sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))[0].title}"`)
    if (dueToday.length) lines.push(`📌 ${dueToday.length} task(s) due today`)
    const highOpen = open.filter(t => t.priority === 'high' && (!t.due || t.due >= today))
    if (highOpen.length) lines.push(`🔥 ${highOpen.length} high-priority task(s) still open`)

    // stale notes (frontmatter validity dates already used by RAG)
    let stale = 0
    for (const dir of ['notes', 'entities']) {
      for (const f of this.memory.list(this.memory.scopePath(dir))) {
        const c = this.memory.read(this.memory.scopePath(`${dir}/${f}`)) ?? ''
        const fm = c.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
        const exp = fm.match(/(?:valido_ate|expires|review_after|stale_after|valid_until):\s*['"]?(\d{4}-\d{2}-\d{2})/i)?.[1]
        if (exp && exp < today) stale++
      }
    }
    if (stale) lines.push(`🕸️ ${stale} note(s) past their validity date — candidates for review or refresh`)

    // search gaps — unanswered queries the brain should learn
    const gaps = this.memory.read(this.memory.scopePath('ops/search-gaps.md')) ?? ''
    const gapCount = (gaps.match(/^- /gm) ?? []).length
    if (gapCount) lines.push(`🔍 ${gapCount} unanswered search(es) logged — the gap-review automation can fill them`)

    // pending approvals
    const pending = this.store.get().pendingApprovals.length
    if (pending) lines.push(`⏳ ${pending} automation(s) waiting for your approval`)

    // activity today
    const act = this.memory.activity(500).filter(e => new Date(e.ts).toISOString().slice(0, 10) === today)
    if (act.length) {
      const byOp = act.reduce<Record<string, number>>((m, e) => ({ ...m, [e.op]: (m[e.op] ?? 0) + 1 }), {})
      lines.push(`✍️ ${act.length} memory change(s) today (${Object.entries(byOp).map(([k, v]) => `${v} ${k}`).join(', ')})`)
    }

    // entity graph size
    const entities = this.memory.list(this.memory.scopePath('entities')).length
    if (entities) lines.push(`🕸️ Knowledge graph: ${entities} entity page(s) with backlinks`)

    // vault pulse — real activity across the whole imported brain
    const recent = this.recentVaultNotes(14)
    if (recent.length) {
      const byDir = recent.reduce<Record<string, number>>((m, n) => ({ ...m, [n.dir]: (m[n.dir] ?? 0) + 1 }), {})
      const topDirs = Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, c]) => `${d} (${c})`).join(', ')
      lines.push(`📡 ${recent.length} note(s) touched in the last 14 days — hottest areas: ${topDirs}`)
      const hot = recent.slice(0, 3).map(n => `"${n.title}"`).join(' · ')
      lines.push(`🧠 Most recent: ${hot}`)
    } else {
      const total = this.memory.allRelFiles().filter(f => f.endsWith('.md')).length
      if (total > 50) lines.push(`🗂️ Vault holds ${total} notes — no edits in the last 2 weeks`)
    }

    if (!lines.length) lines.push('🌱 Quiet day — no urgent signals. The brain kept consolidating in the background.')
    return lines.slice(0, 6)
  }

  async briefing(force = false): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const cachePath = `summaries/briefing-${day}.md`
    const cached = this.memory.read(this.memory.scopePath(cachePath))
    if (cached?.trim() && !force) return cached

    const goalsRaw = this.memory.read(this.memory.scopePath(`daily/${day}.md`)) ?? ''
    const goals = goalsRaw.replace(/^#\s*Goals.*$/m, '').replace(/_No goals yet\._/, '').trim()
    const openTasks = this.readTasks().filter(t => t.status === 'open')
    const tasksTxt = openTasks.slice(0, 15)
      .map(t => `- ${t.title}${t.due ? ` (due ${t.due})` : ''}${t.priority !== 'normal' ? ` [${t.priority}]` : ''}`).join('\n') || '(none)'
    const overdue = openTasks.filter(t => t.due && t.due < day).length
    const recent = this.recentVaultNotes(10, 12)
      .map(n => `- ${n.title} — ${n.dir}/`).join('\n') || '(no recent edits)'
    const insightFile = this.memory.list(this.memory.scopePath('insights')).sort().pop()
    const insight = insightFile ? (this.memory.read(this.memory.scopePath(`insights/${insightFile}`)) ?? '').slice(0, 1500) : '(none yet)'
    const vaultTotal = this.memory.allRelFiles().filter(f => f.endsWith('.md')).length

    const context = [
      `Today: ${day}`,
      `Vault size: ${vaultTotal} notes`,
      goals ? `## Today's goals\n${goals}` : '## Today\'s goals\n(none set — suggest some)',
      `## Open tasks (${openTasks.length}${overdue ? `, ${overdue} overdue` : ''})\n${tasksTxt}`,
      `## Recently active notes\n${recent}`,
      `## Latest insight report\n${insight}`
    ].join('\n\n')

    const res = await chat(this.store.get().ai as AiProviderConfig, [
      {
        role: 'system',
        content: `You are KeepMind — the user's persistent second brain. Write their daily briefing. Rules:
- Warm, direct, concise. The user's language.
- Structure: 2-3 sentence orientation → "Today" (what matters now: overdue/due tasks, goals) → "From your vault" (what recent notes suggest — themes, loose threads, things worth revisiting) → one concrete suggested focus.
- Ground EVERYTHING in the provided data — never invent tasks, notes or facts. If data is thin, say so briefly.
- Markdown, max ~250 words. No preamble.`
      },
      { role: 'user', content: context }
    ], [], this.localLlm?.endpoint)

    const text = `# Briefing — ${day}\n\n${res.text}\n`
    this.memory.write(this.memory.scopePath(cachePath), text)
    this.note('processed', `Briefing de ${day} escrito.`, cachePath)
    return text
  }

  compactLongTerm(): string {
    const budgets: Record<string, number> = {
      'facts.md': 12000,
      'lessons.md': 8000,
      'skills.md': 10000
    }
    let removed = 0
    let trimmed = 0
    for (const [file, budget] of Object.entries(budgets)) {
      const raw = this.memory.read(this.memory.scopePath(`long-term/${file}`))
      if (!raw) continue
      if (file === 'facts.md') {
        const next = compactLegacy(raw)
        if (next !== raw) {
          this.memory.write(this.memory.scopePath(`long-term/${file}`), next)
          trimmed++
        }
        continue
      }
      const seen = new Set<string>()
      const kept: string[] = []
      for (const line of raw.split('\n')) {
        const key = line.trim().toLowerCase()
        if (key.startsWith('- ') && seen.has(key)) { removed++; continue }
        if (key.startsWith('- ')) seen.add(key)
        kept.push(line)
      }
      let text = kept.join('\n').replace(/\n{3,}/g, '\n\n')
      if (text.length > budget) {
        text = `…\n${text.slice(-budget)}`
        trimmed++
      }
      if (text !== raw) this.memory.write(this.memory.scopePath(`long-term/${file}`), text.endsWith('\n') ? text : `${text}\n`)
    }
    const sentence = trimmed
      ? `Compactação: ${removed} linha(s) repetida(s) saíram e ${trimmed} arquivo(s) ficaram no orçamento do prompt.`
      : `Compactação: ${removed} linha(s) repetida(s) saíram da memória longa.`
    this.note('improved', sentence, 'long-term/facts.md')
    return sentence
  }

  escalateTasks(): string {
    const day = new Date().toISOString().slice(0, 10)
    const hits: string[] = []
    for (const f of this.memory.list(this.memory.scopePath('tasks'))) {
      const content = this.memory.read(this.memory.scopePath(`tasks/${f}`)) ?? ''
      if (!/status:\s*open/.test(content)) continue
      const title = (content.match(/^#\s+(.+)$/m)?.[1] ?? f).trim()
      const due = content.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1]
      const priority = content.match(/priority:\s*(high|normal|low)/)?.[1] ?? 'normal'
      if (priority === 'high') hits.push(`${title} (prioridade alta)`)
      else if (due && due < day) hits.push(`${title} (atrasada desde ${due})`)
    }
    const sentence = hits.length
      ? `${hits.length} tarefa(s) pedem atenção: ${hits.slice(0, 3).join('; ')}.`
      : 'Nenhuma tarefa atrasada ou de prioridade alta.'
    this.note(hits.length ? 'needs-you' : 'processed', sentence, hits.length ? 'tasks/' : undefined)
    return sentence
  }

  closeSearchGaps(): string {
    const raw = this.memory.read(this.memory.scopePath('ops/search-gaps.md')) ?? ''
    if (!raw.trim()) {
      const sentence = 'Nenhuma lacuna de busca aberta.'
      this.note('processed', sentence, 'ops/search-gaps.md')
      return sentence
    }
    let closed = 0
    const next = raw.split('\n').map(line => {
      if (line.includes('→')) return line
      const q = line.match(/"([^"]+)"/)?.[1]
      if (!q) return line
      const hit = this.searchVault(q)[0]
      if (!hit) return line
      closed++
      this.rememberQuestion(q, hit.snippet || hit.title, 'gap')
      return `${line} → ${hit.path}`
    })
    if (closed) this.memory.write(this.memory.scopePath('ops/search-gaps.md'), next.join('\n'))
    const open = next.filter(l => /"[^"]+"/.test(l) && !l.includes('→')).length
    const sentence = closed
      ? `Fechei ${closed} lacuna(s) de busca com arquivos da memória. ${open} continuam sem resposta.`
      : `${open} lacuna(s) de busca continuam sem arquivo correspondente.`
    this.note(closed ? 'improved' : 'processed', sentence, 'ops/search-gaps.md')
    return sentence
  }

  async isSemanticDuplicate(candidate: string, existing: string): Promise<boolean> {
    if (!this.laya?.status().available || !existing.trim()) return false
    const p = await this.laya.yesNo(
      `New item: ${candidate.slice(0, 600)}\n\nExisting memory:\n${existing.slice(-4000)}`,
      'Is the new item already captured by the existing memory?'
    ).catch(() => null)
    return p != null && p > 0.72
  }

  listSleepReports(): { date: string; content: string }[] {
    return this.memory.list(this.memory.scopePath('sleep')).sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(this.memory.scopePath(`sleep/${f}`)) ?? ''
    }))
  }

  memoryTierStats() {
    return {
      shortTerm: this.memory.shortTermFiles().length,
      mediumTerm: this.memory.mediumTermFiles().length,
      longTerm: this.memory.countFiles(this.memory.scopePath('long-term')),
      sleepCycles: this.memory.list(this.memory.scopePath('sleep')).length
    }
  }

  listInsights(): { date: string; content: string }[] {
    return this.memory.list(this.memory.scopePath('insights')).sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(this.memory.scopePath(`insights/${f}`)) ?? ''
    }))
  }

  listSummaries(): { date: string; content: string }[] {
    return this.memory.list(this.memory.scopePath('summaries')).sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(this.memory.scopePath(`summaries/${f}`)) ?? ''
    }))
  }

  readMemoryFile(rel: string): string | null {
    try { return this.memory.read(this.memory.scopePath(rel)) } catch { return null }
  }

  protected readTasks() {
    return this.memory.list(this.memory.scopePath('tasks')).map(f => {
      const c = this.memory.read(this.memory.scopePath(`tasks/${f}`)) ?? ''
      const meta = c.match(/^>\s*(.+)$/m)?.[1] ?? ''
      return {
        file: f,
        id: f.replace(/\.md$/, ''),
        title: c.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.replace(/\.md$/, ''),
        status: /status:\s*done/i.test(meta) ? 'done' : 'open',
        priority: meta.match(/priority:\s*(\w+)/i)?.[1]?.toLowerCase() ?? 'normal',
        due: meta.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
      }
    })
  }

  async triageVaultTasks() {
    const marker = 'ops/vault-tasks-triaged.md'
    // Permanent guard: the ops/ marker lives inside the synced vault and can be
    // deleted by vault cleanup, which would re-import archived tasks forever.
    // This flag lives in config.json (userData, never synced) and survives.
    if (this.store.get().vaultTasksTriaged || this.memory.read(this.memory.scopePath(marker))) {
      if (!this.store.get().vaultTasksTriaged) this.store.set({ vaultTasksTriaged: true })
      return { skipped: true }
    }
    const seen = new Set<string>()
    const out: { title: string; src: string }[] = []
    const cbRe = /^\s*[-*+]\s+\[ \]\s+(.{3,200}?)\s*$/gm
    for (const f of this.memory.allRelFiles()) {
      if (!f.endsWith('.md')) continue
      const segs = f.split('/')
      if (segs[0] === 'tasks' || segs[0] === 'ops' || segs.slice(0, -1).some(s => s.startsWith('.'))) continue
      const c = this.memory.read(this.memory.scopePath(f))
      if (!c) continue
      for (const m of c.matchAll(cbRe)) {
        const title = m[1].replace(/\[\[([^\]|]+)\|?[^\]]*\]\]/g, '$1').trim()
        const key = title.toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push({ title, src: f })
        if (out.length >= 400) break
      }
      if (out.length >= 400) break
    }
    for (const t of out) {
      const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${slug(t.title)}-${Math.random().toString(36).slice(2, 6)}`
      this.memory.write(this.memory.scopePath(`tasks/${id}.md`),
        `# ${t.title}\n> status: open · priority: normal · created: ${new Date().toISOString()}\n\n_source: ${t.src}_\n`)
    }
    this.memory.quietWrite(this.memory.scopePath(marker), `# Vault task triage\n\n_imported ${out.length} open checkbox items from vault markdown on ${new Date().toISOString()}_\n`)
    this.store.set({ vaultTasksTriaged: true })
    return { imported: out.length }
  }

  protected ensurePolicy() {
    if (this.memory.read(this.memory.scopePath('ops/policy.md'))) return
    this.memory.write(this.memory.scopePath('ops/policy.md'), [
      '# Política do cérebro',
      '',
      '## Ativo',
      '',
      'Sem instruções extras ainda. Uma proposta aprovada passa a valer aqui e o sono seguinte lê este bloco.',
      '',
      '## Propostas',
      ''
    ].join('\n'))
  }

  policy(): { active: string; proposals: string[] } {
    this.ensurePolicy()
    const raw = this.memory.read(this.memory.scopePath('ops/policy.md')) ?? ''
    const [head, tailPart] = raw.split('## Propostas')
    const active = (head.split('## Ativo')[1] ?? '').trim()
    const proposals = (tailPart ?? '').split('\n').map(l => l.trim()).filter(l => l.startsWith('- '))
    return { active, proposals }
  }

  applyLatestPolicy(): string {
    this.ensurePolicy()
    const raw = this.memory.read(this.memory.scopePath('ops/policy.md')) ?? ''
    const tailPart = raw.split('## Propostas')[1]
    const proposals = (tailPart ?? '').split('\n').map(l => l.trim()).filter(l => l.startsWith('- '))
    const last = proposals.pop()
    if (!last) return 'Nenhuma proposta para aplicar.'
    const body = last.replace(/^- \d{4}-\d{2}-\d{2}:\s*/, '')
    const next = [
      '# Política do cérebro',
      '',
      '## Ativo',
      '',
      body,
      '',
      '## Propostas',
      '',
      ...proposals,
      ''
    ].join('\n')
    this.memory.write(this.memory.scopePath('ops/policy.md'), next)
    this.note('improved', 'A política ativa do cérebro foi atualizada com a última proposta.', 'ops/policy.md')
    return 'Política ativa atualizada. O próximo sono vai seguir este texto.'
  }

  protected factsRaw(): string {
    return this.memory.read(this.memory.scopePath('long-term/facts.md')) ?? ''
  }

  protected writeFacts(raw: string) {
    this.memory.write(this.memory.scopePath('long-term/facts.md'), raw.endsWith('\n') ? raw : `${raw}\n`)
  }

  protected proposeFact(text: string, origin: FactOrigin, source: string, announce = true): string {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean.length < 3) return ''
    const next = addProposal(this.factsRaw(), clean, source, origin)
    this.writeFacts(next.raw)
    if (announce) this.note('needs-you', 'Uma proposta de fato espera você em Hoje.', 'long-term/facts.md')
    return next.id
  }

  captureFact(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean.length < 3) return 'Escreva uma frase para guardar.'
    const next = addActive(this.factsRaw(), clean, 'atalho', 'user')
    this.writeFacts(next.raw)
    this.note('discovered', 'A frase capturada já vale como fato ativo.', 'long-term/facts.md')
    return 'Frase guardada. Ela já vale.'
  }

  correctFact(claim: string, correction: string): string {
    const nextText = correction.replace(/\s+/g, ' ').trim()
    const wrong = claim.replace(/\s+/g, ' ').trim()
    if (nextText.length < 3) return 'Escreva a correção.'
    const current = this.factsRaw()
    const needle = wrong.slice(0, 80).toLowerCase()
    const match = needle.length < 12 ? '' : (readFacts(current).facts.find(f =>
      f.status === 'active' && (f.text.toLowerCase().includes(needle.slice(0, 40)) || needle.includes(f.text.toLowerCase().slice(0, 40)))
    )?.id ?? '')
    const next = addActive(current, nextText, 'isto está errado', 'user', match)
    this.writeFacts(next.raw)
    const evalRaw = this.memory.read(this.memory.scopePath('ops/eval.md')) ?? ''
    this.memory.write(this.memory.scopePath('ops/eval.md'), addEvalQuestion(evalRaw, wrong.slice(0, 240) || 'Qual é a correção?', nextText, 'correction'))
    this.note('improved', 'A correção já vale. A resposta anterior saiu da memória ativa.', 'long-term/facts.md')
    return 'Correção gravada. Ela já vale, e a avaliação vai conferir isso no próximo sono.'
  }

  factQueue(): { id: string; text: string; since: string; origin: string; source: string; previous: string }[] {
    const raw = this.factsRaw()
    return proposalsOf(raw).map(p => ({
      id: p.id,
      text: p.text,
      since: p.since,
      origin: p.origin,
      source: p.source,
      previous: p.supersedes ? (factById(raw, p.supersedes)?.text ?? '') : ''
    }))
  }

  acceptFact(id: string): string {
    const next = acceptProposal(this.factsRaw(), id)
    if (!next.ok) return 'Essa proposta não está mais na fila.'
    this.writeFacts(next.raw)
    this.note('improved', 'Você aceitou um fato. Ele entra na memória ativa.', 'long-term/facts.md')
    return 'Fato aceito. O próximo prompt já pode usá-lo.'
  }

  discardFact(id: string): string {
    const next = discardProposal(this.factsRaw(), id)
    if (!next.ok) return 'Essa proposta não está mais na fila.'
    this.writeFacts(next.raw)
    this.note('processed', 'Você descartou uma proposta de fato.', 'long-term/facts.md')
    return 'Proposta descartada.'
  }

  protected rememberQuestion(q: string, a: string, source: 'gap' | 'correction') {
    const raw = this.memory.read(this.memory.scopePath('ops/eval.md')) ?? ''
    const next = addEvalQuestion(raw, q, a, source)
    if (next !== raw) this.memory.write(this.memory.scopePath('ops/eval.md'), next)
  }

  protected harvestGapQuestions() {
    const raw = this.memory.read(this.memory.scopePath('ops/search-gaps.md')) ?? ''
    for (const line of raw.split('\n')) {
      if (!line.includes('→')) continue
      const q = line.match(/"([^"]+)"/)?.[1]
      const answer = line.split('→').slice(1).join('→').trim()
      if (q && answer) this.rememberQuestion(q, answer, 'gap')
    }
  }

  protected scoreQuestions(day: string): { hit: number; total: number } {
    const raw = this.memory.read(this.memory.scopePath('ops/eval.md')) ?? ''
    if (!raw.trim()) return { hit: 0, total: 0 }
    const corpus = [
      activeForPrompt(this.factsRaw()),
      this.memory.read(this.memory.scopePath('long-term/lessons.md')) ?? ''
    ].join('\n')
    const scored = scoreEval(raw, corpus, day)
    this.memory.write(this.memory.scopePath('ops/eval.md'), scored.raw)
    return { hit: scored.hit, total: scored.total }
  }

  evalStatus(): { questions: { q: string; source: string }[]; last: { day: string; hit: number; total: number } | null } {
    const doc = readEval(this.memory.read(this.memory.scopePath('ops/eval.md')) ?? '')
    return {
      questions: doc.questions.map(item => ({ q: item.q, source: item.source })),
      last: doc.scores[doc.scores.length - 1] ?? null
    }
  }

  async hybridSearch(query: string): Promise<{
    hits: { path: string; title: string; snippet: string }[]
    semantic: boolean
    notice: string
    asOf: string | null
  }> {
    const asOf = parseAsOf(query)
    if (asOf) {
      const raw = this.factsRaw()
      const dated = factsAsOf(raw, asOf)
      const source = this.memory.scopePath('long-term/facts.md')
      const classification = policy(raw)
      const version = createHash('sha256').update(raw).digest('hex')
      const hits = dated.map(f => ({
        path: source,
        title: f.text.split('\n')[0].slice(0, 80),
        snippet: `[historical as of ${asOf}; id: ${f.id}; source: ${f.source || 'unknown'}; space: ${classification.space}; class: ${classification.class}; sha256: ${version}] ${f.since}${f.until ? ` até ${f.until}` : ' em diante'} · ${f.text}`
      }))
      const undated = readFacts(raw).legacy.trim() ? ' Texto sem data não entra nessa consulta.' : ''
      const notice = hits.length
        ? `O que valia em ${monthLabel(asOf)}.${undated}`
        : `Não há fato datado que valesse em ${monthLabel(asOf)}. Texto sem data não entra nessa consulta.`
      return { hits: hits.slice(0, 12), semantic: false, notice, asOf }
    }
    const lexical = this.searchVault(query)
    const ready = this.rag?.semanticReady() ?? false
    if (!ready) {
      return {
        hits: lexical,
        semantic: false,
        notice: lexical.length
          ? 'A busca semântica está parada. Estes resultados são só por texto.'
          : 'A busca semântica está parada. Nada casou por texto.',
        asOf: null
      }
    }
    const semanticHits = await this.rag?.semanticHits(query).catch(() => []) ?? []
    const seen = new Set(lexical.map(h => h.path))
    const hits = [...lexical]
    for (const hit of semanticHits) {
      if (seen.has(hit.path)) continue
      seen.add(hit.path)
      hits.push(hit)
      if (hits.length >= 12) break
    }
    return { hits, semantic: true, notice: '', asOf: null }
  }

  searchVault(query: string): { path: string; title: string; snippet: string }[] {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const hits: { path: string; title: string; snippet: string }[] = []
    for (const rel of this.memory.allRelFiles()) {
      if (!rel.endsWith('.md')) continue
      const local = rel.replace(/^spaces\/[^/]+\//, '')
      if (local.startsWith('ops/')) continue
      // allRelFiles returns already-resolved authorized paths, including grants.
      const raw = this.memory.read(rel)
      if (raw === null) continue
      const facts = local === 'long-term/facts.md'
      const content = facts ? formatFactSelection(raw) : raw
      if (!content.trim()) continue
      const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? rel
      const hay = `${rel}\n${title}\n${content}`.toLowerCase()
      const at = hay.indexOf(q)
      if (at < 0) continue
      let excerpt = content
      let label = labelMemorySource(rel)
      if (facts) {
        const entries = content.split(/\n\n(?=\[(?:canonical current fact|legacy, undated and unverified))/)
        const entry = entries.find(text => text.toLowerCase().includes(q)) ?? entries[0]
        const newline = entry.indexOf('\n')
        label = entry.slice(1, Math.max(1, newline - 1))
        excerpt = entry.slice(newline + 1)
      }
      const contentAt = excerpt.toLowerCase().indexOf(q)
      const start = Math.max(0, contentAt)
      const classification = policy(raw)
      const version = createHash('sha256').update(raw).digest('hex')
      const snippet = `[${label}; space: ${classification.space}; class: ${classification.class}; sha256: ${version}] ${excerpt.slice(Math.max(0, start - 80), start + 220).replace(/\s+/g, ' ')}`
      hits.push({ path: rel, title, snippet })
      if (hits.length >= 12) break
    }
    return hits
  }

  protected reviewState(): Record<string, { due: number; interval: number }> {
    return this.memory.readOpsJson('review-state.json', {} as Record<string, { due: number; interval: number }>)
  }

  dueCards(limit = 5): { q: string; a: string }[] {
    const raw = this.memory.read(this.memory.scopePath('review/cards.md')) ?? ''
    const cards = [...raw.matchAll(/^Q:\s*(.+)\nA:\s*(.+)$/gm)]
      .map(m => ({ q: m[1].trim(), a: m[2].trim() }))
      .filter(c => c.q && c.a)
    const state = this.reviewState()
    const now = Date.now()
    return cards.filter(c => (state[c.q]?.due ?? 0) <= now).slice(0, limit)
  }

  gradeCard(question: string, rating: 'again' | 'hard' | 'good' | 'easy'): { due: number } {
    const state = this.reviewState()
    const prev = state[question] ?? { due: 0, interval: 0 }
    const day = 86_400_000
    let interval = prev.interval
    if (rating === 'again') interval = 0
    else if (rating === 'hard') interval = Math.max(1, interval || 1)
    else if (rating === 'good') interval = interval < 1 ? 1 : Math.round(interval * 2)
    else interval = interval < 1 ? 3 : Math.round(interval * 3)
    const due = Date.now() + Math.max(interval, rating === 'again' ? 0 : interval) * (rating === 'again' ? 60_000 : day)
    state[question] = { due: rating === 'again' ? Date.now() + 10 * 60_000 : due, interval }
    this.memory.writeOpsJson('review-state.json', state)
    this.note('processed', `Revisão marcada como ${rating}.`, 'review/cards.md')
    return { due: state[question].due }
  }

  protected graphCache: { at: number; data: any; scope: string; keys: unknown } | null = null

  touchGraph() { this.graphCache = null }

  memoryGraph() {
    const files = this.memory.allRelFiles()
      .filter(f => f.endsWith('.md') && !f.split('/').slice(0, -1).some(s => s.startsWith('.')))
    const scope = JSON.stringify([this.memory.currentSpace, this.memory.grants, files])
    if (this.graphCache && this.graphCache.scope === scope && this.graphCache.keys === this.memory.keys && Date.now() - this.graphCache.at < 60_000) return this.graphCache.data
    const idOf = (f: string) => f.replace(/\.md$/, '')
    const byBase = new Map<string, string>()
    const nodes = new Map<string, { id: string; label: string; dir: string; links: number }>()
    for (const f of files) {
      const id = idOf(f)
      const base = f.split('/').pop()!.replace(/\.md$/, '')
      byBase.set(base.toLowerCase(), id)
      nodes.set(id, { id, label: base, dir: f.split('/')[0] ?? '', links: 0 })
    }
    const linkRe = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|\]\(([^)\s]+?\.md)(?:#[^)\s]*)?[^)]*\)/g
    const edgeSet = new Set<string>()
    for (const f of files) {
      const src = idOf(f)
      const content = this.memory.read(this.memory.scopePath(f))
      if (!content) continue
      const dir = f.split('/').slice(0, -1).join('/')
      for (const m of content.matchAll(linkRe)) {
        let target = (m[1] ?? m[2] ?? '').split('#')[0]
        try { target = decodeURIComponent(target) } catch { /* keep raw */ }
        target = target.replace(/\.md$/, '').replace(/^\.\//, '')
        if (!target) continue
        let tid: string | undefined
        if (nodes.has(target)) tid = target
        else {
          const base = target.split('/').pop()!.toLowerCase()
          tid = byBase.get(base)
          if (!tid && dir) {
            const rel = `${dir}/${target}`
            if (nodes.has(rel)) tid = rel
          }
        }
        if (tid && tid !== src && nodes.has(tid)) {
          edgeSet.add(`${src}→${tid}`)
          const n = nodes.get(src)!
          n.links++
        }
      }
    }
    // Cap: keep the most-connected nodes so the 3D view stays interactive
    let nodeList = [...nodes.values()]
    if (nodeList.length > 800) {
      nodeList = nodeList.sort((a, b) => b.links - a.links).slice(0, 800)
    }
    const keep = new Set(nodeList.map(n => n.id))
    const links = [...edgeSet]
      .map(e => e.split('→'))
      .filter(([s, t]) => keep.has(s) && keep.has(t))
      .map(([s, t]) => [s, t])
    const data = { nodes: nodeList, links, totalFiles: files.length }
    this.graphCache = { at: Date.now(), data, scope, keys: this.memory.keys }
    return data
  }
}
