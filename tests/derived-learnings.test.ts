import { it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SpaceKeys, InMemorySecretStore } from '../src/main/services/security/keys'
import { Memory } from '../src/main/services/brain/memory-store'
import { DerivedLearnings } from '../src/main/services/derived-learnings'
let root: string, keys: SpaceKeys, memory: Memory, service: DerivedLearnings
beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'km-learning-')))
  keys = (await SpaceKeys.setup('fictional test credential', new InMemorySecretStore())).keys
  keys.createSpace('demo'); keys.createSpace('other')
  memory = new Memory(join(root, 'memory'), null); memory.keys = keys; memory.currentSpace = 'demo'
  memory.write('notes/demo.md', 'Fictional Zephyr company Ada 2031 singular incident vocabulary.')
  service = new DerivedLearnings(join(root, 'memory'), root, keys, { owner: true, spaces: ['demo'], approval: true })
})
afterEach(() => { keys.lock(); rmSync(root, { recursive: true, force: true }) })
const suggest = () => service.suggest('notes/demo.md', 'Separate proposals from final review.', 'private reflection', 'incentives can still conflict.')
it('requires explicit exact revision approval and has no expiry', () => {
  const draft = suggest()
  expect(service.list('', false)).toEqual([])
  const mcp = new DerivedLearnings(join(root, 'memory'), root, keys, { owner: true, spaces: ['demo'] })
  expect(() => mcp.promote(draft.id, draft.approvalDigest)).toThrow('Explicit')
  expect(() => service.promote(draft.id, 'bad')).toThrow()
  service.promote(draft.id, draft.approvalDigest)
  expect(service.list('', false)).toHaveLength(1)
  expect(() => service.promote(draft.id, draft.approvalDigest)).toThrow()
})
it('allows other owner scopes with redacted provenance, denies nonowners and missing scopes', () => {
  const draft = suggest(); service.promote(draft.id, draft.approvalDigest)
  const other = new DerivedLearnings(join(root, 'memory'), root, keys, { owner: true, spaces: ['other'] })
  const text = JSON.stringify(other.list('proposals', false))
  expect(text).not.toMatch(/demo|Zephyr|provenance|source|version/)
  expect(() => other.sourceDetails(draft.id)).toThrow('Learning unavailable')
  expect(other.checkPublic(draft.id, 'clean text')).toEqual(other.checkPublic('absent', 'clean text'))
  for (const authority of [{ owner: false, spaces: ['demo'] }, { owner: true, spaces: [] }, { owner: true, spaces: ['absent'] }]) expect(() => new DerivedLearnings(join(root, 'memory'), root, keys, authority).list()).toThrow()
})
it('flags ordinary edits, suspends wrong sources and keeps suspension sticky', () => {
  const draft = suggest(); service.promote(draft.id, draft.approvalDigest)
  memory.write('notes/demo.md', 'Fictional edited evidence.')
  expect(service.list('', false)).toHaveLength(1)
  expect(service.sourceDetails(draft.id).sourceChanged).toBe(true)
  service.markSourceWrong(draft.id)
  expect(service.list('', false)).toEqual([])
  expect(service.sourceDetails(draft.id).sourceWrong).toBe(true)
})
it('deletion suspends before retrieval and restoration cannot resurrect', () => {
  const draft = suggest(); service.promote(draft.id, draft.approvalDigest)
  memory.remove('notes/demo.md'); expect(service.list('', false)).toEqual([])
  memory.write('notes/demo.md', 'Restored fictional evidence.')
  expect(service.list('', false)).toEqual([])
})
it('checks names, numbers, dates, unusual situations and source vocabulary without revealing evidence', () => {
  const draft = suggest(); service.promote(draft.id, draft.approvalDigest)
  for (const text of ['Ada works here', 'there were 12', 'in november', 'a unique merger', 'singular vocabulary', 'the Zephyr company']) {
    expect(service.checkPublic(draft.id, text)).toEqual({ result: 'review_required', humanReviewRequired: true, publicationAuthorized: false })
  }
  expect(service.checkPublic(draft.id, 'Separate proposals from final review.')).toEqual({ result: 'no_automatic_risk_detected', humanReviewRequired: false, publicationAuthorized: false })
  memory.remove('notes/demo.md'); expect(service.checkPublic(draft.id, 'clean')).toHaveProperty('humanReviewRequired', true)
})
it('encrypts all fields at rest and rejects traversal, foreign authority and symlinks', () => {
  const draft = suggest()
  const raw = readFileSync(join(root, 'derived-learnings.box'), 'utf8')
  expect(raw).not.toMatch(/Separate|demo|private reflection|source|pending/)
  expect(() => service.suggest('../outside', 'text', 'purpose', 'limits')).toThrow('Learning unavailable')
  memory.currentSpace = 'other'; memory.write('notes/foreign.md', 'fictional foreign')
  expect(() => service.suggest('notes/foreign.md', 'text', 'purpose', 'limits')).toThrow()
  symlinkSync('/etc/passwd', join(root, 'memory/notes/link.md'))
  expect(() => service.suggest('notes/link.md', 'text', 'purpose', 'limits')).toThrow()
  expect(draft.status).toBe('pending')
})
it('MCP requires launcher owner grants and cannot promote with caller arguments or note writes', async () => {
  const { createMemoryServer } = await import('../tools/keepmind-mcp.mjs')
  const draft = suggest(); service.promote(draft.id, draft.approvalDigest)
  const make = (scope: object) => createMemoryServer(join(root, 'memory'), { keys, state: root, clients: { test: scope }, clientId: 'test' })
  const owner = make({ owner: true, spaces: ['other'], maxClass: 'internal', write: true })
  const call = (handle: any, name: string, args = {}) => handle({ id: 1, method: 'tools/call', params: { name, arguments: args } }).result
  const response = call(owner, 'learning_search', { query: 'proposals' })
  expect(response.content[0].text).toContain('Separate proposals')
  expect(call(owner, 'search', { query: 'proposals' }).content[0].text).toContain('Separate proposals')
  expect(response.content[0].text).not.toMatch(/demo|provenance|source|Zephyr/)
  expect(call(owner, 'learning_promote', { id: draft.id, approve: true, owner: true }).isError).toBe(true)
  expect(call(owner, 'sb_write', { path: '../derived-learnings.box', content: 'forged' }).isError).toBe(true)
  for (const scope of [{ spaces: ['other'], maxClass: 'internal' }, { owner: true, spaces: ['other'], maxClass: 'public' }]) {
    expect(call(make(scope), 'learning_list', { owner: true }).isError).toBe(true)
  }
})

it('rejects fictional identifiers in every outward draft field', () => {
  const clean = ['Separate proposals from final review.', 'private reflection', 'incentives can still conflict.']
  for (let field = 0; field < 3; field++) {
    for (const identifier of ['Zephyr', 'zephyr', 'notes/demo.md', 'Ada', '2031']) {
      const fields = [...clean]; fields[field] += ' ' + identifier
      expect(() => service.suggest('notes/demo.md', fields[0], fields[1], fields[2])).toThrow('Learning unavailable')
    }
  }
  expect(service.list(undefined, true)).toEqual([])
})
it('never exposes pending or suspended drafts across owner spaces', () => {
  const pending = suggest(), active = suggest()
  service.promote(active.id, active.approvalDigest)
  const other = new DerivedLearnings(join(root, 'memory'), root, keys, { owner: true, spaces: ['other'] })
  expect(other.list(undefined, true).map(r => r.id)).toEqual([active.id])
  expect(service.list().map(r => r.id)).toEqual([active.id])
  expect(service.list(undefined, true).map(r => r.id)).toContain(pending.id)
  expect(() => other.markSourceWrong(active.id)).toThrow('Learning unavailable')
  expect(() => other.promote(pending.id, pending.approvalDigest)).toThrow()
  service.markSourceWrong(active.id)
  expect(other.list(undefined, true)).toEqual([])
})
it('suspends all records linked to a wrong source, including pending revisions', () => {
  const first = suggest(), second = suggest(), pending = suggest()
  service.promote(first.id, first.approvalDigest); service.promote(second.id, second.approvalDigest)
  service.markSourceWrong(first.id)
  for (const row of [first, second, pending]) expect(service.sourceDetails(row.id).sourceWrong).toBe(true)
  expect(service.list()).toEqual([])
  expect(() => service.promote(pending.id, pending.approvalDigest)).toThrow()
})
it('fails closed on registry lock contention and registry symlinks', async () => {
  const { writeFileSync, unlinkSync } = await import('node:fs')
  suggest()
  writeFileSync(join(root, 'derived-learnings.box.lock'), '')
  expect(() => suggest()).toThrow('Learning unavailable')
  unlinkSync(join(root, 'derived-learnings.box.lock'))
  expect(service.list(undefined, true)).toHaveLength(1)
  const file = join(root, 'derived-learnings.box')
  const original = readFileSync(file, 'utf8')
  writeFileSync(join(root, 'target'), original); unlinkSync(file); symlinkSync(join(root, 'target'), file)
  expect(() => service.list()).toThrow('Learning unavailable')
  expect(readFileSync(join(root, 'target'), 'utf8')).toBe(original)
})

it('rechecks legacy pending fields at promotion and hides unsafe projections', async () => {
  const { writeFileSync } = await import('node:fs')
  for (const field of ['body', 'purpose', 'applicability']) {
    const draft = suggest()
    const file = join(root, 'derived-learnings.box')
    const rows = JSON.parse(keys.decrypt(readFileSync(file, 'utf8'), 'general-knowledge', 'derived-registry:v1'))
    rows.find((r: any) => r.id === draft.id)[field] = 'zephyr'
    writeFileSync(file, keys.encrypt(JSON.stringify(rows), 'general-knowledge', 'derived-registry:v1'))
    expect(() => service.promote(draft.id, (service as any).approvalDigest(rows.find((r: any) => r.id === draft.id)))).toThrow('Learning unavailable')
    expect(service.list(undefined, true).some(r => r.id === draft.id)).toBe(false)
  }
})
it('does not trust an active flag without exact approval and keeps unauthorized actions inert', async () => {
  const { writeFileSync } = await import('node:fs')
  const draft = suggest()
  const file = join(root, 'derived-learnings.box')
  const rows = JSON.parse(keys.decrypt(readFileSync(file, 'utf8'), 'general-knowledge', 'derived-registry:v1'))
  rows[0].status = 'active'
  writeFileSync(file, keys.encrypt(JSON.stringify(rows), 'general-knowledge', 'derived-registry:v1'))
  const other = new DerivedLearnings(join(root, 'memory'), root, keys, { owner: true, spaces: ['other'], approval: true })
  expect(other.list()).toEqual([])
  const before = readFileSync(file, 'utf8')
  for (const id of [draft.id, 'missing']) {
    expect(() => other.markSourceWrong(id)).toThrow('Learning unavailable')
    expect(() => other.sourceDetails(id)).toThrow('Learning unavailable')
    expect(() => other.promote(id, draft.approvalDigest)).toThrow('Learning unavailable')
    expect(other.checkPublic(id, 'clean')).toHaveProperty('humanReviewRequired', true)
  }
  expect(readFileSync(file, 'utf8')).toBe(before)
})

it('ordinary app recall includes only active private projections for the local owner', async () => {
  const { RagService } = await import('../src/main/services/rag')
  const active = suggest(); service.promote(active.id, active.approvalDigest)
  suggest() // pending
  let owner = true
  memory.currentSpace = 'other'
  const model = { embedReady: false, isEmbedModelDownloaded: () => false } as any
  const rag = new RagService(model, memory, root, { root: join(root, 'memory'), isOwner: async () => owner })
  const db = await rag.database()
  try {
    const result = await rag.search('proposals')
    expect(result).toContain(`derived_learning:${active.id} (private)`)
    expect(result).toContain('Separate proposals from final review.')
    expect(result.match(/derived_learning:/g)).toHaveLength(1)
    expect(result).not.toMatch(/demo|Zephyr|provenance|source|approvalDigest|pending/)
    owner = false
    expect(await rag.search('proposals')).toBe('')
    const shared = new RagService(model, memory, root)
    try { expect(await shared.search('proposals')).toBe('') } finally { (await shared.database()).close() }
    owner = true
    service.markSourceWrong(active.id)
    expect(await rag.search('proposals')).toBe('')
    keys.lock()
    expect(await rag.search('proposals')).toBe('')
  } finally { db.close() }
})

it('MCP ordinary search cannot elevate shared/public/empty/unknown scopes via RPC arguments', async () => {
  const { createMemoryServer } = await import('../tools/keepmind-mcp.mjs')
  const active = suggest(); service.promote(active.id, active.approvalDigest)
  suggest()
  const scopes = [
    { spaces: ['other'], maxClass: 'internal', write: true },
    { owner: true, spaces: ['other'], maxClass: 'public' },
    { owner: true, spaces: [], maxClass: 'secret' },
    { owner: true, spaces: ['missing'], maxClass: 'secret' }
  ]
  for (const scope of scopes) {
    const handle = createMemoryServer(join(root, 'memory'), { keys, state: root, clients: { test: scope }, clientId: 'test' })
    for (const name of ['search', 'sb_search', 'learning_search']) {
      const reply = handle({ id: 1, method: 'tools/call', params: { name, arguments: { query: 'proposals', owner: true, spaces: ['demo'], maxClass: 'secret' } } })
      expect(JSON.stringify(reply)).not.toContain('Separate proposals')
      expect(JSON.stringify(reply)).not.toMatch(/Zephyr|provenance|approvalDigest/)
    }
  }
  const owner = createMemoryServer(join(root, 'memory'), { keys, state: root, clients: { test: { owner: true, spaces: ['other'], maxClass: 'internal' } }, clientId: 'test' })
  const call = () => owner({ id: 1, method: 'tools/call', params: { name: 'search', arguments: { query: 'proposals' } } })
  expect(JSON.stringify(call())).toContain(active.id)
  service.markSourceWrong(active.id)
  expect(JSON.stringify(call())).not.toContain('Separate proposals')
})

// Validation gap: this runtime captures no output even from a trivial spawned Node writer.
// Keep the stdin-only end-to-end probe visible; do not substitute argv/env credentials.
it.skip('built encrypted CLI accepts stdin EOF and returns ordinary search without hanging', async () => {
  const { spawn } = await import('node:child_process')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const draft = suggest(); service.promote(draft.id, draft.approvalDigest)
  mkdirSync(join(root, 'security'))
  writeFileSync(join(root, 'security/memory-keys.json'), JSON.stringify(keys.config), { mode: 0o600 })
  // Async spawn lets the parent deliver input while the child awaits stdin EOF.
  // The fictional credential goes only to the supported stdin pipe.
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/keepmind-cli.mjs', 'search', 'proposals', '--dir', join(root, 'memory'), '--state', root, '--space', 'other', '--unlock-stdin'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Encrypted CLI stdin smoke timed out')) }, 10000)
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    child.stdin.on('error', () => {})
    child.stdin.end('fictional test credential\n')
  })
  expect(result.code).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout, JSON.stringify({ code: result.code, stderr: result.stderr, runtime: process.execPath })).not.toBe('')
  expect(JSON.parse(result.stdout)).toEqual([expect.objectContaining({ id: draft.id, body: draft.body })])
  expect(result.stdout).not.toMatch(/fictional test credential|demo|Zephyr|provenance|source/)
}, 15000)
