import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { generateKeyPairSync, createSign } from 'node:crypto'
import {
  can, actions, safeRel, canReadFile, canWriteFile, normalizePolicy,
  clampTeamAutonomy, scanText, verifyRs256, redactSecrets
} from './lib.mjs'
import { createCorp } from './server.mjs'
import { rankMemoryFiles } from './search-hybrid.mjs'
import { normalizeSharedAccess, normalizePeopleAccess } from './abac.mjs'

const secret = `sk-${'a'.repeat(24)}`
assert.equal(safeRel('../etc/passwd'), null)
assert.equal(safeRel('shared/../../people/x.md'), null)
assert.equal(safeRel('people/ana/notes.md'), 'people/ana/notes.md')
assert.equal(can('member', 'policy.write'), false)
assert.equal(can('auditor', 'scan.paths'), false)
assert.equal(can('owner', 'not-an-action'), false)
assert.ok(actions().includes('owner.grant'))
assert.equal(canReadFile('member', 'ana', 'people/bia/notes.md'), false)
assert.equal(canReadFile('member', 'ana', 'people/ana/notes.md'), true)
assert.equal(canWriteFile('member', 'ana', 'shared/x.md'), false)
const abac = normalizeSharedAccess([{ prefix: 'shared/finance', roles: [], titles: ['cfo'], teams: [] }])
assert.equal(canReadFile('member', 'ana', 'shared/finance/ledger.md', { sharedAccess: abac, title: 'CFO Brasil', teamId: 'everyone' }), true)
assert.equal(canReadFile('member', 'ana', 'shared/finance/ledger.md', { sharedAccess: abac, title: 'Estagiário', teamId: 'everyone' }), false)
const peopleAbac = normalizePeopleAccess([{ prefix: 'people/owner/memory/inbox', roles: [], titles: ['cfo'], teams: [] }])
assert.equal(canReadFile('member', 'ana', 'people/owner/memory/inbox/x.md', { peopleAccess: peopleAbac, title: 'CFO Brasil', teamId: 'everyone' }), true)
assert.equal(canReadFile('member', 'ana', 'people/owner/memory/inbox/x.md', { peopleAccess: peopleAbac, title: 'estagiário', teamId: 'everyone' }), false)
assert.equal(rankMemoryFiles([{ abs: '/x', rel: 'people/a/memory/inbox/x.md' }], 'acordo cliente', () => 'acordo com cliente hoje').length, 1)
assert.equal(canWriteFile('auditor', 'ana', 'people/ana/notes.md'), false)
assert.throws(() => normalizePolicy({ memberKeys: true }), /BYOK/)
assert.throws(() => normalizePolicy({ byokRequired: false }), /BYOK/)
assert.throws(() => normalizePolicy({ apiKey: 'sk-secret-value-should-not-stick' }), /environment/)
const policy = normalizePolicy({ providers: ['local', 'openai'], autonomyCeiling: 'autopilot' })
assert.equal(policy.byokRequired, true)
assert.equal(policy.memberKeys, false)
assert.equal(policy.cloudAllowed, true)
assert.throws(() => clampTeamAutonomy('autonomous', 'supervised'), /ceiling/)
const found = scanText('shared/leak.md', `hello ${secret}\n`)
assert.equal(found.secrets.length, 1)
assert.equal(JSON.stringify(found).includes(secret), false)
assert.equal(scanText('shared/sealed.md', 'KMS1\nabc').encrypted, true)
assert.equal(redactSecrets(`key ${secret}`).includes(secret), false)

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = publicKey.export({ format: 'jwk' })
jwk.kid = 'k1'
const now = 1_800_000_000
const sign = payload => {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url')
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signer = createSign('RSA-SHA256')
  signer.update(`${h}.${p}`)
  signer.end()
  return `${h}.${p}.${signer.sign(privateKey).toString('base64url')}`
}
const good = sign({ iss: 'https://idp.example', aud: 'keepmind', exp: now + 600, email: 'ana@example.com', sub: 'ana' })
assert.equal(verifyRs256(good, { issuer: 'https://idp.example', audience: 'keepmind', jwks: { keys: [jwk] }, now }).email, 'ana@example.com')
const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`
assert.throws(() => verifyRs256(none, { issuer: 'https://idp.example', audience: 'keepmind', jwks: { keys: [jwk] }, now }), /RS256/)
assert.throws(() => verifyRs256(sign({ iss: 'https://idp.example', aud: 'other', exp: now + 60 }), { issuer: 'https://idp.example', audience: 'keepmind', jwks: { keys: [jwk] }, now }), /audience/)

const root = mkdtempSync(path.join(tmpdir(), 'keepmind-corp-'))
try {
  const corp = createCorp({
    dataDir: path.join(root, 'data'),
    vault: path.join(root, 'vault'),
    disableGithubScheduler: true,
    env: {
      KEEPMIND_CORP_OWNER_EMAIL: 'owner@example.com',
      KEEPMIND_CORP_OWNER_PASSWORD: 'correct-horse-battery'
    }
  })
  writeFileSync(path.join(corp.vault, 'shared', 'leak.md'), `leak ${secret}\n`)
  writeFileSync(path.join(corp.vault, 'shared', 'sealed.md'), 'KMS1\nQUJD\n')
  const saved = JSON.parse(readFileSync(path.join(corp.vault, 'ops', 'corp-policy.json'), 'utf8'))
  assert.equal(saved.policy.memberKeys, false)
  assert.equal(JSON.stringify(saved).includes('correct-horse'), false)

  const { port, close } = await listen(corp)
  const health = await call(port, '/api/health')
  assert.equal(health.json.edition, 'keepmind-corp')
  const anon = await call(port, '/api/session')
  assert.equal(anon.status, 200)
  assert.equal(anon.json.user, null)
  const page = await call(port, '/')
  assert.equal(page.status, 200)
  assert.match(page.text, /KeepMind Corp/)
  assert.match(page.text, /login\.js/)

  const rootUi = mkdtempSync(path.join(tmpdir(), 'keepmind-corp-ui-'))
  const corpUi = createCorp({
    dataDir: path.join(rootUi, 'data'),
    vault: path.join(rootUi, 'vault'),
    disableGithubScheduler: true,
    env: {}
  })
  const uiSrv = await listen(corpUi)
  const metaUi = await call(uiSrv.port, '/api/meta')
  assert.equal(metaUi.json.setupRequired, true)
  const setupUi = await call(uiSrv.port, '/api/setup', {
    method: 'POST',
    body: {
      orgName: 'UI Test Org',
      name: 'Pat',
      email: 'pat-ui@example.com',
      password: 'long-password-here',
      confirm: 'long-password-here'
    }
  })
  assert.equal(setupUi.status, 201)
  assert.ok(setupUi.cookie)
  assert.equal((await call(uiSrv.port, '/api/meta')).json.setupRequired, false)
  const cfg = await call(uiSrv.port, '/api/brain/config', { cookie: setupUi.cookie })
  assert.equal(cfg.json.onboardingDone, false)
  await call(uiSrv.port, '/api/brain/config', {
    method: 'PATCH',
    cookie: setupUi.cookie,
    body: { onboardingDone: true }
  })
  assert.equal((await call(uiSrv.port, '/api/brain/config', { cookie: setupUi.cookie })).json.onboardingDone, true)
  uiSrv.close()
  rmSync(rootUi, { recursive: true, force: true })

  const bad = await call(port, '/api/login', { method: 'POST', body: { email: 'owner@example.com', password: 'wrong-password-here' } })
  assert.equal(bad.status, 401)
  const owner = await call(port, '/api/login', { method: 'POST', body: { email: 'owner@example.com', password: 'correct-horse-battery' } })
  assert.equal(owner.status, 200)
  assert.ok(owner.cookie)
  assert.equal((await call(port, '/api/session', { cookie: owner.cookie })).json.user.role, 'owner')

  const csrf = await call(port, '/api/policy', { method: 'PUT', cookie: owner.cookie, headers: { 'x-keepmind-corp': '' }, body: { providers: ['local'] } })
  assert.equal(csrf.status, 403)

  const created = await call(port, '/api/members', {
    method: 'POST', cookie: owner.cookie,
    body: { email: 'ana@example.com', name: 'Ana', role: 'member', password: 'ana-has-a-long-password' }
  })
  assert.equal(created.status, 201)
  const auditor = await call(port, '/api/members', {
    method: 'POST', cookie: owner.cookie,
    body: { email: 'audit@example.com', name: 'Audit', role: 'auditor', password: 'auditor-long-password' }
  })
  assert.equal(auditor.status, 201)
  const anaLogin = await call(port, '/api/login', { method: 'POST', body: { email: 'ana@example.com', password: 'ana-has-a-long-password' } })
  const ana = anaLogin.cookie
  assert.equal((await call(port, '/api/policy', { method: 'PUT', cookie: ana, body: { providers: ['openai'] } })).status, 403)
  assert.equal((await call(port, '/api/files/preview?path=people/owner/notes.md', { cookie: ana })).status, 403)
  assert.equal((await call(port, '/api/files/preview?path=../corp/server.mjs', { cookie: ana })).status, 400)
  const blocked = await call(port, '/api/files', { method: 'POST', cookie: ana, body: { path: 'people/ana/notes.md', text: `my key ${secret}` } })
  assert.equal(blocked.status, 400)
  assert.equal(blocked.json.error, 'secret_blocked')
  assert.equal(existsSync(path.join(corp.vault, 'people', 'ana', 'memory', 'inbox', 'welcome.md')), true)
  assert.equal(existsSync(path.join(corp.vault, 'people', 'ana', 'notes.md')), false)
  const savedNote = await call(port, '/api/files', { method: 'POST', cookie: ana, body: { path: 'people/ana/notes.md', text: '# Ana\n\nUma nota pessoal.\n' } })
  assert.equal(savedNote.status, 200)
  const own = await call(port, '/api/files/preview?path=people/ana/notes.md', { cookie: ana })
  assert.match(own.json.text, /Uma nota pessoal/)
  assert.equal((await call(port, '/api/teams', { method: 'PUT', cookie: owner.cookie, body: { teams: [{ id: 'everyone', name: 'Everyone', autonomy: 'autonomous' }] } })).status, 400)

  const scan = await call(port, '/api/scan', { cookie: owner.cookie })
  assert.ok(scan.json.scan.secretTotal >= 1)
  assert.ok(scan.json.scan.encryptedFiles >= 1)
  assert.equal(JSON.stringify(scan.json).includes(secret), false)
  const auditLogin = await call(port, '/api/login', { method: 'POST', body: { email: 'audit@example.com', password: 'auditor-long-password' } })
  const auditScan = await call(port, '/api/scan', { cookie: auditLogin.cookie })
  assert.equal(auditScan.json.scan.secrets, undefined)
  assert.ok(auditScan.json.scan.secretTotal >= 1)
  assert.equal((await call(port, '/api/files/preview?path=people/ana/notes.md', { cookie: auditLogin.cookie })).status, 403)
  assert.equal((await call(port, '/api/audit', { cookie: auditLogin.cookie })).status, 200)
  const demote = await call(port, '/api/members/owner', { method: 'PATCH', cookie: owner.cookie, body: { role: 'admin' } })
  assert.equal(demote.status, 409)

  const agentsPut = await call(port, '/api/agents', {
    method: 'PUT',
    cookie: owner.cookie,
    body: {
      agents: (await call(port, '/api/agents', { cookie: owner.cookie })).json.agents.map((a) => (
        a.id === 'sync' || a.id === 'composer' ? { ...a, enabled: true } : a
      ))
    }
  })
  assert.equal(agentsPut.status, 200)
  const minted = await call(port, '/api/sync-tokens', {
    method: 'POST',
    cookie: owner.cookie,
    body: { label: 'selfcheck', userId: 'owner' }
  })
  assert.equal(minted.status, 201)
  assert.ok(minted.json.token.secret)
  const pushed = await call(port, '/api/brain/import', {
    method: 'POST',
    headers: { authorization: `Bearer ${minted.json.token.secret}` },
    body: { files: [{ path: 'inbox/selfcheck-push.md', content: '# sync\n\ntoken import ok\n' }] }
  })
  assert.equal(pushed.status, 200)
  assert.equal(pushed.json.imported, 1)
  const off = await call(port, '/api/brain/import', {
    method: 'POST',
    headers: { authorization: 'Bearer invalid-token-value' },
    body: { files: [] }
  })
  assert.equal(off.status, 401)

  const mcpSession = await call(port, '/api/mcp/call', {
    method: 'POST',
    cookie: owner.cookie,
    body: { agentId: 'composer', tool: 'sb_search', arguments: { query: 'welcome' } }
  })
  assert.equal(mcpSession.status, 200)
  const mcpBearer = await call(port, '/api/mcp/call', {
    method: 'POST',
    headers: { authorization: `Bearer ${minted.json.token.secret}` },
    body: { agentId: 'composer', tool: 'sb_list', arguments: { limit: 5 } }
  })
  assert.equal(mcpBearer.status, 200)

  const meter = await call(port, '/api/metering', { cookie: owner.cookie })
  assert.equal(meter.status, 200)
  assert.ok(Array.isArray(meter.json.teams))

  await close()
  await checkOidc(root)
  console.log('keepmind corp selfcheck ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}

async function checkOidc(root) {
  let idToken = ''
  const fetchImpl = async url => {
    const href = String(url)
    if (href.endsWith('/.well-known/openid-configuration')) {
      return json({ authorization_endpoint: 'https://idp.example/auth', token_endpoint: 'https://idp.example/token', jwks_uri: 'https://idp.example/jwks' })
    }
    if (href.endsWith('/token')) return json({ id_token: idToken })
    if (href.endsWith('/jwks')) return json({ keys: [jwk] })
    throw new Error(`unexpected ${href}`)
  }
  const corp = createCorp({
    dataDir: path.join(root, 'oidc-data'),
    vault: path.join(root, 'oidc-vault'),
    disableGithubScheduler: true,
    env: {},
    fetchImpl,
    oidc: { issuer: 'https://idp.example', clientId: 'keepmind', clientSecret: 'client-secret', redirectUri: 'http://127.0.0.1/api/oidc/callback', adminGroup: 'keepmind-admins' }
  })
  const { port, close } = await listen(corp)
  const start = await call(port, '/api/oidc/start')
  assert.equal(start.status, 302)
  const state = new URL(start.location).searchParams.get('state')
  idToken = sign({ iss: 'https://idp.example', aud: 'keepmind', exp: now + 600, email: 'bia@example.com', sub: 'bia', name: 'Bia' })
  const back = await call(port, `/api/oidc/callback?code=abc&state=${state}`)
  assert.equal(back.status, 302)
  const me = await call(port, '/api/me', { cookie: back.cookie })
  assert.equal(me.json.user.role, 'member')
  assert.equal(me.json.user.email, 'bia@example.com')

  const again = await call(port, '/api/oidc/start')
  const state2 = new URL(again.location).searchParams.get('state')
  idToken = sign({ iss: 'https://idp.example', aud: 'keepmind', exp: now + 600, email: 'bia@example.com', sub: 'bia', groups: ['keepmind-admins'] })
  const promoted = await call(port, `/api/oidc/callback?code=abc&state=${state2}`)
  const me2 = await call(port, '/api/me', { cookie: promoted.cookie })
  assert.equal(me2.json.user.role, 'admin')

  const third = await call(port, '/api/oidc/start')
  const state3 = new URL(third.location).searchParams.get('state')
  const h = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url')
  const p = Buffer.from(JSON.stringify({ iss: 'https://idp.example', aud: 'keepmind', email: 'evil@example.com' })).toString('base64url')
  idToken = `${h}.${p}.`
  const rejected = await call(port, `/api/oidc/callback?code=abc&state=${state3}`)
  assert.equal(rejected.status, 400)
  await close()
}

function json(value) {
  return { ok: true, status: 200, json: async () => value }
}

function listen(corp) {
  const server = createServer((req, res) => {
    corp.handle(req, res).catch(err => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.code || 'server_error', message: err.message }))
      }
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise(done => server.close(done))
      })
    })
  })
}

async function call(port, pathname, { method = 'GET', body, cookie, headers } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(method === 'GET' ? {} : { 'x-keepmind-corp': '1' }),
      ...(cookie ? { cookie } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let parsed = text
  try { parsed = JSON.parse(text) } catch { /* html page */ }
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const token = setCookie.map(item => item.split(';')[0]).find(item => item.startsWith('kmcorp=')) || ''
  return { status: res.status, json: parsed, text, cookie: token, location: res.headers.get('location') }
}
