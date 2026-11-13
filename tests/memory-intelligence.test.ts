import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Memory } from '../src/main/services/brain/memory-store'
import { SpaceKeys, InMemorySecretStore } from '../src/main/services/security/keys'
import { MemoryIntelligence } from '../src/main/services/memory-intelligence'
import { createContinuityService } from '../src/main/services/continuity'
import { createMemoryServer } from '../tools/keepmind-mcp.mjs'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'km-intelligence-')); dirs.push(root)
  const { keys } = await SpaceKeys.setup('fixture passphrase', new InMemorySecretStore())
  keys.createSpace('personal'); keys.createSpace('company')
  const memory = new Memory(root, null); memory.keys = keys
  return { root, keys, memory }
}
const response = { text: 'Synthetic answer [source:facts]', toolCalls: [] }
const ai = () => ({ provider: 'local' as const, model: 'model-one', apiKey: 'private-credential-sentinel' })

it('persists encrypted synthetic reports, isolates spaces, and snapshots config without sending private memory', async () => {
  const {root,keys,memory} = await fixture()
  try {
    memory.write('notes/private.md', 'private-vault-sentinel')
    let config = ai(), release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    const seen: any[] = []
    const service = new MemoryIntelligence(memory, { configuration: () => ({ai: config, localModelId:'model-one'}), ensureLocal: () => ready, complete: async (cfg,messages) => { seen.push({cfg:{...cfg},messages}); return response } })
    const pending = service.runBenchmark()
    config = { ...config, model:'model-two', apiKey:'changed-credential' }
    release()
    const report = await pending
    expect(report.model).toBe('model-one'); expect(report.calls).toBe(12)
    expect(seen.every(x => x.cfg.model === 'model-one')).toBe(true)
    expect(JSON.stringify(seen.map(x=>x.messages))).not.toContain('private-vault-sentinel')
    expect(JSON.stringify(seen.map(x=>x.messages))).not.toContain('private-credential-sentinel')
    const file = join(root, `ops/answer-benchmarks/${report.id}.json`)
    const disk = readFileSync(file,'utf8'); expect(disk).toMatch(/^KEEPMIND-ITEM:1/); expect(disk).not.toContain('Synthetic answer')
    expect(new MemoryIntelligence(memory,{configuration:()=>({ai:config})}).listBenchmarks()[0].id).toBe(report.id)
    const mcp = createMemoryServer(root,{keys,clients:{default:{spaces:['personal'],maxClass:'internal'}}})
    const search = mcp({id:1,method:'tools/call',params:{name:'search',arguments:{query:'Synthetic answer'}}})
    expect(JSON.stringify(search)).not.toContain(report.id)
    memory.currentSpace = 'company'
    expect(service.listBenchmarks()).toEqual([])
  } finally { keys.lock() }
})

it('cancels a hung startup without calls and isolates cancellation by space', async () => {
  const {keys,memory} = await fixture()
  try {
    const complete = vi.fn(async () => response)
    const service = new MemoryIntelligence(memory,{configuration:()=>({ai:ai()}),ensureLocal:()=>new Promise(()=>{}),complete})
    const pending = service.runBenchmark()
    await expect(service.runBenchmark()).rejects.toThrow('BENCHMARK_BUSY')
    memory.currentSpace = 'company'; expect(service.cancelBenchmark()).toBe(false)
    memory.currentSpace = 'personal'; expect(service.cancelBenchmark()).toBe(true)
    const result = await pending
    expect(result.status).toBe('cancelled'); expect(result.calls).toBe(0); expect(complete).not.toHaveBeenCalled()
    const another = service.runBenchmark(); expect(service.cancelBenchmark()).toBe(true); expect((await another).status).toBe('cancelled')
  } finally { keys.lock() }
})

it('passes correctly scoped inherited classification and evidence to analysis', async () => {
  const {keys,memory} = await fixture()
  try {
    memory.currentSpace='company'
    memory.write(memory.scopePath('notes/source.md'),'---\nclass: sensitive\nspace: company\n---\nEvidence is reliable.')
    const continuity = createContinuityService(memory)
    let p = continuity.dispatch('create',{title:'Plan',evidence:['notes/source.md']})
    p = continuity.dispatch('add_decision',{projectId:p.id,expectedRevision:p.revision,choice:'Ship',evidence:['notes/source.md']})
    const complete = vi.fn(async (_cfg,messages,_endpoint,egress) => {
      expect(egress.space).toBe('company'); expect(egress.class).toBe('sensitive')
      const input = JSON.parse(messages[1].content)
      expect(input.sources[0].content).toContain('Evidence is reliable.')
      return {text:JSON.stringify({summary:'Reviewed',findings:[{decisionId:p.decisions[0].id,relationship:'uncertain',explanation:'Review',sourcePath:'notes/source.md',quote:'Evidence is reliable.'}],outcomeAssessments:[]})}
    })
    const service = new MemoryIntelligence(memory,{configuration:()=>({ai:ai()}),ensureLocal:async()=>{},complete})
    const updated = await service.projectAnalyze({projectId:p.id,expectedRevision:p.revision})
    expect(updated.analysisReports[0].findings[0].status).toBe('proposed')
  } finally { keys.lock() }
})

it('rejects encrypted report tampering on reload', async () => {
  const {keys,memory} = await fixture()
  try {
    const service = new MemoryIntelligence(memory,{configuration:()=>({ai:ai()}),ensureLocal:async()=>{},complete:async()=>response})
    const report = await service.runBenchmark()
    const path = `ops/answer-benchmarks/${report.id}.json`
    report.suiteCases[0].criterion = 'tampered'
    memory.write(path, JSON.stringify(report))
    expect(()=>service.listBenchmarks()).toThrow('BENCHMARK_RECORD_INVALID')
  } finally { keys.lock() }
})
