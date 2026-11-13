import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer, type Server } from 'node:http'
import { corpCrm, startCrmScheduler, corpExternalSafe, extractCorpCapture } from '../corp/crm-api.mjs'
import { invokeCorpMcpTool } from '../corp/mcp-runtime.mjs'
import { canReadFile, canWriteFile } from '../corp/lib.mjs'
import { createCorp } from '../corp/server.mjs'
import { setOrgSecrets } from '../corp/org-secrets.mjs'
import { createSyncToken } from '../corp/sync-tokens-store.mjs'
import { setLlmSecrets, getLlmSecret } from '../corp/llm-secrets.mjs'

const dirs: string[] = []
const servers: Server[] = []
afterEach(async () => { for (const s of servers.splice(0)) await new Promise<void>(resolve => s.close(() => resolve())); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function fixture() {
  const vault = mkdtempSync(path.join(tmpdir(), 'km-crm-')); dirs.push(vault)
  const a = { id: 'alice', role: 'member', teamId: 'alpha', name: 'Alice' }
  const b = { id: 'bob', role: 'member', teamId: 'beta', name: 'Bob' }
  const c = { id: 'carl', role: 'member', teamId: 'alpha', name: 'Carl' }
  const auditor = { id: 'auditor', role: 'auditor', teamId: 'alpha', name: 'Auditor' }
  const org = { users: [a, b, c, auditor], teams: [{ id: 'alpha' }, { id: 'beta' }] }
  return { vault, org, a, b, c, auditor }
}

describe('corporate CRM access', () => {
  it('isolates personal and team boards, enforces revisions and read-only auditor access', () => {
    const { vault, org, a, b, c, auditor } = fixture()
    const alice = corpCrm(vault, org, a)
    const one = alice.dispatch('create_contact', { name: 'Private', expectedRevision: 0 })
    expect(one.contacts[0].name).toBe('Private')
    expect(corpCrm(vault, org, b).dispatch('snapshot').contacts).toEqual([])
    expect(() => alice.dispatch('create_contact', { name: 'Stale', expectedRevision: 0 })).toThrow('REVISION_CONFLICT')
    const team = corpCrm(vault, org, a, 'team')
    team.dispatch('create_contact', { name: 'Team', expectedRevision: 0 })
    expect(corpCrm(vault, org, c, 'team').dispatch('snapshot').contacts[0].name).toBe('Team')
    expect(team.capabilities.canConfigure).toBe(false)
    expect(() => team.dispatch('settings', { expectedRevision: 1, allowAutomaticSend: true })).toThrow('forbidden')
    expect(corpCrm(vault, org, b, 'team').dispatch('snapshot').contacts).toEqual([])
    expect(canReadFile('owner', 'bob', 'shared/crm/teams/alpha/crm/relationships.md', { teamId: 'beta' })).toBe(false)
    expect(canReadFile('owner', 'bob', 'people/alice/memory/crm/relationships.md', { teamId: 'beta' })).toBe(false)
    expect(corpCrm(vault, org, auditor, 'team').dispatch('snapshot').contacts[0].name).toBe('Team')
    expect(() => corpCrm(vault, org, auditor, 'team').dispatch('create_contact', { name: 'No', expectedRevision: 1 })).toThrow('forbidden')
    expect(corpCrm(vault, org, { ...b, teamId: 'alpha' }, 'team').dispatch('snapshot').contacts).toEqual([])
    expect(corpCrm(vault, org, { ...auditor, role: 'admin' }, 'team').capabilities.canWrite).toBe(false)
    expect(() => corpCrm(vault, org, a, '../beta')).toThrow('bad_board')
  })
  it('blocks elevated tools, managed file writes, unsafe evidence and symlinks', async () => {
    const { vault, org, a } = fixture(); const crm = corpCrm(vault, org, a)
    const s = crm.dispatch('create_contact', { name: 'Alice', expectedRevision: 0 })
    expect(() => crm.dispatch('settings', { expectedRevision: 1, allowAutomaticSend: true }, 'agent')).toThrow('forbidden')
    expect(() => crm.dispatch('begin_delivery', { expectedRevision: 1 }, 'connector')).toThrow('bad_action')
    expect(canWriteFile('owner', a.id, `people/${a.id}/memory/crm/relationships.md`)).toBe(false)
    expect(() => crm.dispatch('record_interaction', { expectedRevision: 1, contactId: s.contacts[0].id, channel: 'note', direction: 'internal', body: 'x', source: { path: '../../other.md' } })).toThrow('EVIDENCE_PATH_DENIED')
    mkdirSync(path.join(vault, 'people', a.id, 'memory', 'notes'), { recursive: true })
    symlinkSync('/tmp', path.join(vault, 'people', a.id, 'memory', 'notes', 'escape'))
    expect(() => crm.dispatch('record_interaction', { expectedRevision: 1, contactId: s.contacts[0].id, channel: 'note', direction: 'internal', body: 'x', source: { path: 'notes/escape/file.md' } })).toThrow('EVIDENCE_PATH_DENIED')
    await expect(invokeCorpMcpTool({ vault, org, user: a, agentId: 'composer', tool: 'crm_settings', args: { expectedRevision: 1 }, memoryFiles: [], readAbs: () => '' })).rejects.toThrow('forbidden')
  })
  it('sweeps existing boards on startup and later, without creating empty boards', async () => {
    const { vault, org, a, b } = fixture()
    const crm = corpCrm(vault, org, a)
    let snap = crm.dispatch('create_contact', { name: 'Partner', expectedRevision: 0 })
    snap = crm.dispatch('create_commitment', { expectedRevision: snap.revision, contactId: snap.contacts[0].id, title: 'Reply', waitingOn: 'them', dueAt: '2020-01-01' })
    const stop = startCrmScheduler(vault, () => org, 20)
    try {
      await new Promise(resolve => setTimeout(resolve, 5))
      expect(crm.dispatch('snapshot').drafts).toHaveLength(1)
      expect(existsSync(path.join(vault, 'people', b.id))).toBe(false)
      snap = crm.dispatch('snapshot')
      crm.dispatch('create_commitment', { expectedRevision: snap.revision, contactId: snap.contacts[0].id, title: 'Another reply', waitingOn: 'them', dueAt: '2020-01-01' })
      await new Promise(resolve => setTimeout(resolve, 40))
      expect(crm.dispatch('snapshot').drafts).toHaveLength(2)
    } finally { stop() }
  })
  it('honors scoped LLM credentials including organization default', () => {
    const { vault, a, b } = fixture()
    setLlmSecrets(vault, [{ provider: 'openai', value: 'org-key' }, { provider: 'openai', scope: 'team:alpha', value: 'team-key' }, { provider: 'openai', scope: 'user:alice', value: 'user-key' }])
    expect(getLlmSecret(vault, 'openai', a)).toBe('user-key')
    expect(getLlmSecret(vault, 'openai', { ...a, id: 'carl' })).toBe('team-key')
    expect(getLlmSecret(vault, 'openai', b)).toBe('org-key')
  })
  it('requires invoke scope for CRM mutations and omits CRM content from audit', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'km-scope-')); dirs.push(dir)
    const app = createCorp({ dataDir: dir, oidc: false, disableGithubScheduler: true, disableCrmScheduler: true, env: { KEEPMIND_CORP_OWNER_EMAIL: 'owner@example.com', KEEPMIND_CORP_OWNER_PASSWORD: 'correct horse battery' } })
    app.org.agents.find((a: any) => a.id === 'composer').enabled = true
    app.org.agents.find((a: any) => a.id === 'sync').enabled = true
    const user = app.org.users[0]
    const readToken = createSyncToken(app.vault, { label: 'reader', userId: user.id, createdBy: user.id, scopes: ['mcp:read'] }).secret
    const writeToken = createSyncToken(app.vault, { label: 'writer', userId: user.id, createdBy: user.id, scopes: ['mcp:invoke'] }).secret
    const server = createServer(app.handle); servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as any).port}`
    const call = (token: string, tool: string, args: any) => fetch(`${base}/api/mcp/call`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ tool, args }) })
    expect((await call(readToken, 'crm_snapshot', {})).status).toBe(200)
    expect((await call(readToken, 'crm_create_contact', { name: 'Private person', expectedRevision: 0 })).status).toBe(403)
    expect((await call(writeToken, 'crm_create_contact', { name: 'Private person', expectedRevision: 0 })).status).toBe(200)
    const log = readFileSync(path.join(app.vault, 'ops', 'mcp-invocations.jsonl'), 'utf8')
    expect(log).not.toContain('Private person')
  })
  it('applies the capture timezone at extraction and persistence', async () => {
    const { vault, org, a } = fixture()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T01:00:00Z'))
    try {
      const text = 'Contato: Ana; prometi enviar proposta amanhã'
      const { extraction } = await extractCorpCapture(vault, org, a, text, undefined, { timeZone: 'America/Sao_Paulo' })
      expect(extraction.dueAt).toBe('2026-11-14')
      const crm = corpCrm(vault, org, a)
      const snapshot = crm.dispatch('capture', { text, extraction, timeZone: 'America/Sao_Paulo', expectedRevision: 0 })
      expect(snapshot.commitments[0].dueAt).toBe('2026-11-14')
    } finally { vi.useRealTimers() }
  })
  it('prevents restricted memory from reaching the cloud and bounds MCP snapshots', async () => {
    const { vault, org, a } = fixture()
    expect(corpExternalSafe('KMS1\nopaque')).toBe(false)
    expect(corpExternalSafe('KEEPMIND-ITEM:1\nopaque')).toBe(false)
    expect(corpExternalSafe('---\nclass: secret\nspace: personal\n---\ncontent')).toBe(false)
    expect(corpExternalSafe('email ana@example.com')).toBe(false)
    expect(corpExternalSafe('ordinary text')).toBe(true)
    org.policy = { providers: ['openai'] } as any
    setOrgSecrets(vault, { openai: 'test-cloud-key' })
    const cloud = vi.spyOn(globalThis, 'fetch')
    try {
      const extracted = await extractCorpCapture(vault, org, a, 'Contato: Ana; email ana@example.com', undefined)
      expect(extracted.method).toBe('rules')
      expect(cloud).not.toHaveBeenCalled()
    } finally { cloud.mockRestore() }
    const crm = corpCrm(vault, org, a)
    const first = crm.dispatch('create_contact', { name: 'Person', notes: 'PRIVATE NOTE', expectedRevision: 0 })
    crm.dispatch('record_interaction', { contactId: first.contacts[0].id, body: 'PRIVATE HISTORY', channel: 'note', direction: 'internal', expectedRevision: 1 })
    const snapshot = JSON.parse(await invokeCorpMcpTool({ vault, org, user: a, agentId: 'composer', tool: 'crm_snapshot', args: {}, memoryFiles: [], readAbs: () => '' }))
    expect(snapshot.contacts[0].name).toBe('Person')
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE NOTE')
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE HISTORY')
    const file = path.join(vault, 'people', a.id, 'memory', 'crm', 'relationships.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace('class: internal', 'class: sensitive'))
    expect(crm.externalModelAllowed()).toBe(false)
  })
  it('allows a scoped agent to import legacy contacts without modifying source', async () => {
    const { vault, org, a } = fixture()
    const dir = path.join(vault, 'people', a.id, 'memory', 'crm', 'people')
    mkdirSync(dir, { recursive: true })
    const source = '# Legacy Person\n\nSaved details.\n'
    const file = path.join(dir, 'legacy.md'); writeFileSync(file, source)
    const result = JSON.parse(await invokeCorpMcpTool({ vault, org, user: a, agentId: 'composer', tool: 'crm_import_legacy', args: { expectedRevision: 0 }, memoryFiles: [], readAbs: () => '' }))
    expect(result.lastResult.imported).toBe(1)
    expect(readFileSync(file, 'utf8')).toBe(source)
  })
  it('inherits classification from evidence and rejects encrypted evidence', () => {
    const { vault, org, a } = fixture(); const crm = corpCrm(vault, org, a)
    const first = crm.dispatch('create_contact', { name: 'Person', expectedRevision: 0 })
    const dir = path.join(vault, 'people', a.id, 'memory', 'notes'); mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'source.md'), '---\nclass: sensitive\nspace: personal\n---\nPrivate source\n')
    crm.dispatch('record_interaction', { contactId: first.contacts[0].id, expectedRevision: 1, channel: 'note', direction: 'internal', body: 'Derived idea', source: { path: 'notes/source.md' } })
    const file = path.join(vault, 'people', a.id, 'memory', 'crm', 'relationships.md')
    expect(readFileSync(file, 'utf8')).toContain('class: sensitive')
    expect(crm.externalModelAllowed()).toBe(false)
    writeFileSync(path.join(dir, 'encrypted.md'), 'KMS1\nopaque')
    expect(() => crm.dispatch('record_interaction', { contactId: first.contacts[0].id, expectedRevision: 2, channel: 'note', direction: 'internal', body: 'Derived idea', source: { path: 'notes/encrypted.md' } })).toThrow('EVIDENCE_UNAVAILABLE')
  })
  it('serves authenticated API and preserves real identity', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'km-http-')); dirs.push(dir)
    const app = createCorp({ dataDir: dir, oidc: false, disableGithubScheduler: true, disableCrmScheduler: true, env: { KEEPMIND_CORP_OWNER_EMAIL: 'owner@example.com', KEEPMIND_CORP_OWNER_PASSWORD: 'correct horse battery' } })
    const server = createServer(app.handle); servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as any).port}`
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-keepmind-corp': '1' }, body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse battery' }) })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    const session = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()
    expect(session.user.id).toBe(app.org.users[0].id); expect(session.orgNamespace).toBeTruthy()
    const post = await fetch(`${base}/api/crm`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-keepmind-corp': '1' }, body: JSON.stringify({ action: 'create_contact', args: { name: 'Real', expectedRevision: 0 } }) })
    expect(post.status).toBe(200)
    const snapshot = await (await fetch(`${base}/api/crm`, { headers: { cookie } })).json()
    expect(snapshot.contacts[0].name).toBe('Real'); expect(snapshot.capabilities.canSend).toBe(false)
    expect((await fetch(`${base}/api/crm`)).status).toBe(401)
  })
})
