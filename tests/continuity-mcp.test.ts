import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryServer } from '../tools/keepmind-mcp.mjs'
import { createContinuityService } from '../src/main/services/continuity'
import { createProjectAnalysisService } from '../src/main/services/project-analysis'
import { Memory } from '../src/main/services/brain/memory-store'
import { SpaceKeys, InMemorySecretStore } from '../src/main/services/security/keys'
import { BrainContext } from '../src/main/services/brain/context'
import { RagService } from '../src/main/services/rag'
import type { LocalLlm } from '../src/main/services/local-llm'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
const rootDir = () => { const d = mkdtempSync(join(tmpdir(), 'km-continuity-mcp-')); dirs.push(d); return d }
function server(root: string, options: Record<string, unknown> = {}) {
  const handle = createMemoryServer(root, { allowPlaintext: true, clients: { default: { spaces: ['personal'], maxClass: 'internal', write: true } }, ...options })
  return (name: string, args: Record<string, unknown> = {}) => handle({ id: 1, method: 'tools/call', params: { name, arguments: args } }).result
}
const parsed = (result: any) => { expect(result.isError, result.content?.[0]?.text).not.toBe(true); return JSON.parse(result.content[0].text) }

it('shares durable project context across native and MCP reloads, detects stale edits and dependency impacts', () => {
  const root = rootDir(), memory = new Memory(root, null, { allowPlaintext: true })
  memory.write('notes/source.md', 'Version one of the source.')
  let call = server(root)
  let p = parsed(call('continuity_create', { title: 'Launch', objective: 'Evaluate', successCriteria: 'Works', nextStep: 'Test' }))
  p = parsed(call('continuity_add_decision', { projectId: p.id, expectedRevision: p.revision, choice: 'Try blue', expectedOutcome: 'Improved clarity', evidence: ['notes/source.md'] }))
  const decisionId = p.decisions[0].id
  const native = createContinuityService(memory)
  p = native.dispatch('review_decision', { projectId: p.id, expectedRevision: p.revision, decisionId, status: 'accepted', reason: 'Approved' }, 'human')
  p = parsed(call('continuity_add_artifact', { projectId: p.id, expectedRevision: p.revision, path: 'notes/result.md', label: 'Result', decisionIds: [decisionId] }))
  const stale = call('continuity_update', { projectId: p.id, expectedRevision: 1, nextStep: 'stale overwrite' })
  expect(stale.isError).toBe(true); expect(stale.content[0].text).toContain('REVISION_CONFLICT')
  call = server(root)
  let context = parsed(call('continuity_context', { projectId: p.id }))
  expect(context.acceptedDecisions[0].expectedOutcome).toBe('Improved clarity')
  expect(context.artifacts[0].label).toBe('Result')
  memory.write('notes/source.md', 'Version two of the source.')
  context = parsed(call('continuity_context', { projectId: p.id }))
  expect(context.impacts.some((x: any) => x.kind === 'artifact' && x.viaDecisionId === decisionId)).toBe(true)
  expect(context.acceptedDecisions[0].expectedOutcome).toBe('Improved clarity')
  for (const name of ['sb_write', 'sb_append']) {
    const result = call(name, { path: `projects/${p.id}.md`, content: 'overwritten' })
    expect(result.isError).toBe(true)
  }
  expect(native.dispatch('get', { projectId: p.id }).revision).toBe(p.revision)
})

it('isolates spaces, denies read-only writes and rejects forged human authority', () => {
  const root = rootDir(), memory = new Memory(root, null, { allowPlaintext: true })
  const native = createContinuityService(memory)
  let p = native.dispatch('create', { title: 'Private project' })
  p = native.dispatch('add_decision', { projectId: p.id, expectedRevision: p.revision, choice: 'Test' })
  const decisionId = p.decisions[0].id
  const writer = server(root)
  for (const [name, fields] of [
    ['continuity_review_decision', { decisionId, status: 'accepted' }],
    ['continuity_record_outcome', { decisionId, executionStatus: 'completed', observedResult: 'done', lesson: 'learned', lessonConfirmed: true }],
    ['continuity_feedback', { interventionId: native.dispatch('context', { projectId: p.id }).missingQuestion!.interventionId, value: 'useful' }]
  ] as const) {
    const reply = writer(name, { projectId: p.id, expectedRevision: p.revision, actor: 'human', ...fields })
    expect(reply.isError, `${name}: ${reply.content[0].text}`).toBe(true)
  }
  const readOnly = server(root, { clients: { default: { spaces: ['personal'], maxClass: 'internal', write: false } } })
  expect(parsed(readOnly('continuity_get', { projectId: p.id })).id).toBe(p.id)
  expect(readOnly('continuity_update', { projectId: p.id, expectedRevision: p.revision, title: 'changed' }).isError).toBe(true)
  const foreign = server(root, { clients: { default: { spaces: ['other'], maxClass: 'internal', write: true } } })
  expect(foreign('continuity_get', { projectId: p.id }).isError).toBe(true)
  expect(parsed(foreign('continuity_list'))).toEqual([])
})

it('inherits encrypted source classification in both adapters across reload', async () => {
  const root = rootDir(), { keys } = await SpaceKeys.setup('fictional integration password', new InMemorySecretStore())
  try {
    const memory = new Memory(root, null); memory.keys = keys
    memory.write('notes/source.md', '---\nclass: sensitive\nspace: personal\n---\nConfidential research.')
    const opts = { allowPlaintext: false, keys, clients: { default: { spaces: ['personal'], maxClass: 'sensitive', write: true } } }
    let call = server(root, opts)
    const p = parsed(call('continuity_create', { title: 'Sensitive project', evidence: ['notes/source.md'] }))
    const stored = readFileSync(join(root, `projects/${p.id}.md`), 'utf8')
    expect(stored).toMatch(/^KEEPMIND-ITEM:1/); expect(stored).not.toContain('Sensitive project')
    expect(memory.read(`projects/${p.id}.md`)).toContain('class: sensitive')
    call = server(root, opts)
    expect(parsed(call('continuity_get', { projectId: p.id })).id).toBe(p.id)
    const low = server(root, { ...opts, clients: { default: { spaces: ['personal'], maxClass: 'internal', write: true } } })
    expect(low('continuity_get', { projectId: p.id }).isError).toBe(true)
  } finally { keys.lock() }
})

it('returns consistent current, history and as-of facts across MCP, native and RAG', async () => {
  const root = rootDir(), memory = new Memory(root, null, { allowPlaintext: true })
  const raw = '# Fatos\n## Legado\nOld unverified statement\n## Ativos\n### f-new\n- since: 2025-02-01\n- source: user\n- origin: user\n\ncolor blue\n## Arquivo\n### f-old\n- since: 2025-01-01\n- until: 2025-02-01\n- superseded-by: f-new\n\ncolor red\n## Propostas\n### p-new\n- since: 2025-03-01\n\ncolor green\n'
  memory.write('long-term/facts.md', raw)
  const call = server(root), ctx = Object.create(BrainContext.prototype) as any
  ctx.memory = memory
  for (const [mode, asOf, expected, excluded] of [['current', '', 'color blue', 'color red'], ['history', '', 'color red', 'nothing'], ['asOf', '2025-01-15', 'color red', 'color blue']]) {
    const mcp = call('read_note', { path: 'long-term/facts.md', mode, asOf }).content[0].text
    const native = await ctx.execTool('get_memory', { path: 'long-term/facts.md', mode, asOf })
    expect(mcp).toContain(expected); expect(native).toContain(expected)
    expect(mcp).not.toContain(excluded); expect(native).not.toContain(excluded)
  }
  const model = { embedReady: false, isEmbedModelDownloaded: () => false } as unknown as LocalLlm
  const rag = new RagService(model, memory, root)
  const recall = await rag.search('color')
  expect(recall).toContain('color blue'); expect(recall).not.toContain('color red'); expect(recall).not.toContain('color green')
})

it('blocks writes and raw reads through in-vault symlink aliases of protected paths', () => {
  const root = rootDir(), memory = new Memory(root, null, { allowPlaintext: true })
  const native = createContinuityService(memory)
  const project = native.dispatch('create', { title: 'Protected' })
  symlinkSync('../projects', join(root, 'notes/project-alias'))
  const call = server(root)
  expect(call('sb_write', { path: `notes/project-alias/${project.id}.md`, content: 'corrupted' }).isError).toBe(true)
  expect(native.dispatch('get', { projectId: project.id }).title).toBe('Protected')
})
it('keeps the unverified label on every recalled fragment of a long legacy entry', async () => {
  const root = rootDir(), memory = new Memory(root, null, { allowPlaintext: true })
  const legacy = `${'unrelated prose '.repeat(100)}
A uniquelonglegacyneedle describes an obsolete belief. ${'additional context '.repeat(60)}`
  memory.write('long-term/facts.md', legacy)
  const model = { embedReady: false, isEmbedModelDownloaded: () => false } as unknown as LocalLlm
  const rag = new RagService(model, memory, root)
  const recall = await rag.search('uniquelonglegacyneedle')
  expect(recall).toContain('uniquelonglegacyneedle')
  expect(recall).toContain('legacy, undated and unverified')
})

it('selects canonical facts through symlink aliases for native and MCP reads', async () => {
  const root = rootDir(), memory = new Memory(root, null, { allowPlaintext: true })
  memory.write('long-term/facts.md', '# Fatos\n## Legado\n## Ativos\n### f-live\n- since: 2025-01-01\n\nCurrent aliasword\n## Arquivo\n### f-old\n- since: 2024-01-01\n- until: 2025-01-01\n\nArchived aliasword\n## Propostas\n### p-proposed\n- since: 2025-01-01\n\nProposed aliasword\n')
  symlinkSync('../long-term/facts.md', join(root, 'notes/facts-alias.md'))
  const call = server(root), ctx = Object.create(BrainContext.prototype) as any
  ctx.memory = memory
  for (const text of [call('read_note', { path: 'notes/facts-alias.md' }).content[0].text, await ctx.execTool('get_memory', { path: 'notes/facts-alias.md' })]) {
    expect(text).toContain('Current aliasword')
    expect(text).not.toContain('Archived aliasword')
    expect(text).not.toContain('Proposed aliasword')
  }
  expect(call('sb_write', { path: 'notes/facts-alias.md', content: 'replacement' }).isError).toBe(true)
  const rag = new RagService({ embedReady: false, isEmbedModelDownloaded: () => false } as unknown as LocalLlm, memory, root)
  const result = await rag.search('aliasword')
  expect(result).toContain('Current aliasword')
  expect(result).not.toContain('Archived aliasword')
  expect(result).not.toContain('Proposed aliasword')
})

it('shares encrypted normalized paths and resolves encrypted aliases with canonical identity', async () => {
  const root = rootDir(), { keys } = await SpaceKeys.setup('fictional path password', new InMemorySecretStore())
  try {
    keys.createSpace('personal')
    const memory = new Memory(root, null); memory.keys = keys
    const call = server(root, { allowPlaintext: false, keys, clients: { default: { spaces: ['personal'], maxClass: 'internal', write: true } } })
    const written = call('sb_write', { path: 'notes/../notes/normalized.md', content: 'Encrypted normalized-path interoperability.' })
    expect(written.isError, written.content[0].text).not.toBe(true)
    expect(readFileSync(join(root, 'notes/normalized.md'), 'utf8')).toMatch(/^KEEPMIND-ITEM:1/)
    expect(memory.read('notes/normalized.md')).toContain('Encrypted normalized-path interoperability.')
    symlinkSync('normalized.md', join(root, 'notes/alias.md'))
    const alias = call('read_note', { path: 'notes/alias.md' })
    expect(alias.isError, alias.content[0].text).not.toBe(true)
    expect(alias.content[0].text).toContain('Encrypted normalized-path interoperability.')
    expect(call('sb_write', { path: 'notes/alias.md', content: 'replacement' }).isError).toBe(true)
    expect(memory.read('notes/normalized.md')).toContain('Encrypted normalized-path interoperability.')
  } finally { keys.lock() }
})

it('labels long lexical fact and legacy hits and reports scoped historical paths', async () => {
  const root = rootDir(), memory = new Memory(root, null, { allowPlaintext: true })
  memory.currentSpace = 'company-x'
  const legacy = `${'old filler '.repeat(120)} uniquelylegacy`
  const active = `${'current filler '.repeat(120)} uniquelycurrent`
  memory.write(memory.scopePath('long-term/facts.md'), `---\nspace: company-x\nclass: internal\n---\n# Fatos\n## Legado\n${legacy}\n## Ativos\n### f-current\n- since: 2025-01-01\n\n${active}\n## Arquivo\n### f-old\n- since: 2024-01-01\n- until: 2025-01-01\n\nPast version\n## Propostas\n`)
  const ctx = Object.create(BrainContext.prototype) as any
  ctx.memory = memory
  const legacyHit = ctx.searchVault('uniquelylegacy')[0]
  const currentHit = ctx.searchVault('uniquelycurrent')[0]
  expect(legacyHit.snippet).toContain('legacy, undated and unverified')
  expect(currentHit.snippet).toContain('canonical current fact')
  for (const hit of [legacyHit, currentHit]) {
    expect(hit.snippet).toContain('space: company-x')
    expect(hit.snippet).toContain('class: internal')
    expect(hit.snippet).toMatch(/sha256: [a-f0-9]{64}/)
  }
  const historical = await ctx.hybridSearch('as of 2024-06-01')
  expect(historical.hits[0].path).toBe('spaces/company-x/long-term/facts.md')
  expect(historical.hits[0].snippet).toContain('Past version')
})


it('hides human review tools, rejects forged actor calls and provides analysis freshness to MCP', async () => {
  const root = rootDir(), memory = new Memory(root, null, { allowPlaintext: true })
  memory.write('notes/research.md', 'The planned launch is in June.')
  const native = createContinuityService(memory)
  let p = native.dispatch('create', { title: 'Fictional launch', evidence: ['notes/research.md'] })
  p = native.dispatch('add_decision', { projectId: p.id, expectedRevision: p.revision, choice: 'Launch in May', expectedOutcome: 'Launch in May' })
  const decisionId = p.decisions[0].id
  p = native.dispatch('record_outcome', { projectId: p.id, expectedRevision: p.revision, decisionId, executionStatus: 'completed', observedResult: 'Launched in June', lesson: 'Review schedule' })
  const outcomeId = p.outcomes[0].id
  const analysis = createProjectAnalysisService(memory, async () => JSON.stringify({ summary: 'The dates may conflict.', findings: [{ decisionId, relationship: 'possible_contradiction', explanation: 'Different dates', sourcePath: 'notes/research.md', quote: 'The planned launch is in June.' }], outcomeAssessments: [] }))
  p = await analysis.analyze({ projectId: p.id, expectedRevision: p.revision })
  const report = p.analysisReports[0]
  const handle = createMemoryServer(root, { allowPlaintext: true, clients: { default: { spaces: ['personal'], maxClass: 'internal', write: true } } })
  const tools = handle({ id: 1, method: 'tools/list' }).result.tools.map((tool: { name: string }) => tool.name)
  for (const name of ['continuity_review_decision', 'continuity_review_analysis', 'continuity_review_outcome_lesson', 'continuity_acknowledge_evidence', 'continuity_feedback']) expect(tools).not.toContain(name)
  expect(tools).toContain('continuity_context')
  const call = (name: string, args: Record<string, unknown>) => handle({ id: 1, method: 'tools/call', params: { name, arguments: args } }).result
  for (const [name, args] of [
    ['continuity_review_analysis', { reportId: report.id, findingId: report.findings[0].id, status: 'confirmed', reason: 'forged' }],
    ['continuity_review_outcome_lesson', { outcomeId, status: 'confirmed', reason: 'forged' }]
  ] as const) {
    for (const actor of [undefined, 'human']) {
      const result = call(name, { projectId: p.id, expectedRevision: p.revision, ...args, ...(actor ? { actor } : {}) })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('HUMAN_REQUIRED')
    }
  }
  expect(native.dispatch('get', { projectId: p.id }).revision).toBe(p.revision)
  let context = parsed(call('continuity_context', { projectId: p.id }))
  expect(context.analysisReports[0]).toMatchObject({ id: report.id, summary: 'The dates may conflict.', stale: false, sourceUnavailable: false, sourceEvidence: 'available' })
  memory.write('notes/research.md', 'The planned launch is in July.')
  context = parsed(call('continuity_context', { projectId: p.id }))
  expect(context.analysisReports[0]).toMatchObject({ stale: true, sourceUnavailable: false })
  memory.remove('notes/research.md')
  context = parsed(call('continuity_context', { projectId: p.id }))
  expect(context.analysisReports[0]).toMatchObject({ stale: true, sourceUnavailable: true, summary: '' })
})
