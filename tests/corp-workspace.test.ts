import { createSign, generateKeyPairSync } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { get, createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCorp } from '../corp/server.mjs'
import { workspaceConfig } from '../corp/workspace.mjs'
const dirs: string[] = [], servers: Server[] = []
afterEach(async () => { for (const s of servers.splice(0)) await new Promise<void>(r => s.close(() => r())); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const setup = { setupToken: 'a'.repeat(64), orgName: 'Aurora', name: 'Admin', email: 'owner@aurora.test', password: 'synthetic-password', confirm: 'synthetic-password' }
async function fixture(extra: Record<string, any> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'corp-workspace-')); dirs.push(dir)
  let corp: any, time = Date.now(), fail = false
  const mail: any[] = []
  const server = createServer((req, res) => corp.handle(req, res)); servers.push(server)
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as any).port}`
  const env = { KEEPMIND_CORP_MODE: 'server', KEEPMIND_CORP_PUBLIC_URL: url, KEEPMIND_CORP_EMAIL_DOMAINS: 'aurora.test', KEEPMIND_CORP_SETUP_TOKEN: setup.setupToken }
  const reopen = () => { corp = createCorp({ dataDir: dir, env, oidc: false, disableCrmScheduler: true, disableGithubScheduler: true, now: () => time, mailer: async (m: any) => { if (fail) throw Error('SMTP failure'); mail.push(m) }, ...extra }) }
  reopen()
  const req = async (route: string, body?: any, cookie = '', method = body === undefined ? 'GET' : 'POST', origin = url) => {
    const res = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'x-keepmind-corp': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] || '' }
  }
  return { dir, url, req, mail, reopen, advance: () => { time += 49 * 3600000 }, failMail: () => { fail = true } }
}
const token = (m: any) => /#invite=([a-f0-9]{64})/.exec(m.text)![1]
it('requires safe deployment configuration', () => {
  expect(() => workspaceConfig({ KEEPMIND_CORP_MODE: 'server' })).toThrow()
  expect(() => workspaceConfig({ KEEPMIND_CORP_PUBLIC_URL: 'http://corp.example.com' })).toThrow()
  expect(() => workspaceConfig({ KEEPMIND_CORP_PUBLIC_URL: 'https://corp.example.com/subpath' })).toThrow()
  expect(workspaceConfig({ KEEPMIND_CORP_PUBLIC_URL: 'https://corp.example.com' }).secure).toBe(true)
})
it('protects first workspace creation from takeover, CSRF, wrong domains and concurrent setup', async () => {
  const f = await fixture()
  expect((await f.req('/api/setup', { ...setup, setupToken: 'wrong' })).status).toBe(403)
  expect((await f.req('/api/setup', setup, '', 'POST', 'https://evil.test')).status).toBe(403)
  expect((await f.req('/api/setup', { ...setup, email: 'x@other.test' })).status).toBe(400)
  const results = await Promise.all([f.req('/api/setup', setup), f.req('/api/setup', setup)])
  expect(results.map(r => r.status).sort()).toEqual([201, 409])
  const saved = JSON.parse(readFileSync(path.join(f.dir, 'org.json'), 'utf8'))
  expect(saved.users).toHaveLength(1); expect(saved.name).toBe('Aurora')
  expect(JSON.stringify(saved)).not.toContain(setup.setupToken)
  expect(await new Promise<number>(resolve => { get(f.url + '/api/meta', { headers: { Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode!) }) })).toBe(400)
})
it('delivers bound single-use invitations, persists membership and isolates members from administration', async () => {
  const f = await fixture(), owner = (await f.req('/api/setup', setup)).cookie
  expect((await f.req('/api/invitations', { email: 'x@sub.aurora.test' }, owner)).status).toBe(400)
  expect((await f.req('/api/invitations', { email: 'hidden,ana@aurora.test' }, owner)).status).toBe(400)
  expect((await f.req('/api/members', { email: 'x@aurora.test' }, owner)).status).toBe(409)
  const sent = await f.req('/api/invitations', { email: 'ANA@aurora.test', role: 'member' }, owner)
  expect(sent.status).toBe(201); const secret = token(f.mail[0])
  expect(JSON.stringify(sent.body)).not.toContain(secret)
  expect(readFileSync(path.join(f.dir, 'org.json'), 'utf8')).not.toContain(secret)
  expect((await f.req('/api/invitations', { email: 'ana@aurora.test' }, owner)).status).toBe(409)
  const accept = { token: secret, email: 'ana@aurora.test', name: 'Ana', password: 'password-for-ana', confirm: 'password-for-ana', role: 'owner' }
  expect((await f.req('/api/invitations/accept', { ...accept, email: 'bob@aurora.test' })).status).toBe(400)
  const results = await Promise.all([f.req('/api/invitations/accept', accept), f.req('/api/invitations/accept', accept)])
  expect(results.map(r => r.status).sort()).toEqual([201, 410])
  const member = results.find(r => r.status === 201)!
  expect(member.body.user.role).toBe('member')
  expect((await f.req('/api/invitations', undefined, member.cookie)).status).toBe(403)
  expect((await f.req('/api/invitations', { email: 'bob@aurora.test' }, member.cookie)).status).toBe(403)
  expect((await f.req('/api/login', { email: accept.email, password: accept.password }, '', 'POST', 'https://evil.test')).status).toBe(403)
  f.reopen()
  expect((await f.req('/api/login', { email: accept.email, password: accept.password })).status).toBe(200)
  expect((await f.req('/api/invitations/accept', accept)).status).toBe(410)
  await f.req('/api/invitations', { email: 'next@aurora.test' }, owner)
  const liveToken = token(f.mail.at(-1)); const other = await fixture()
  expect((await f.req('/api/invitations/inspect', { token: liveToken })).status).toBe(200)
  expect((await other.req('/api/invitations/inspect', { token: liveToken })).status).toBe(410)
})
it('rejects revoked/expired/failed invitations and restricts privileged invitations', async () => {
  const f = await fixture(), owner = (await f.req('/api/setup', setup)).cookie
  const invite = async (email: string, role = 'member') => f.req('/api/invitations', { email, role }, owner)
  const revoked = await invite('revoked@aurora.test'); const rt = token(f.mail.at(-1))
  expect((await f.req('/api/invitations/' + revoked.body.invitation.id, undefined, owner, 'DELETE')).status).toBe(200)
  expect((await f.req('/api/invitations/inspect', { token: rt })).status).toBe(410)
  await invite('expired@aurora.test'); const et = token(f.mail.at(-1)); f.advance()
  expect((await f.req('/api/invitations/inspect', { token: et })).status).toBe(410)
  await invite('admin@aurora.test', 'admin'); const at = token(f.mail.at(-1))
  const admin = await f.req('/api/invitations/accept', { token: at, email: 'admin@aurora.test', name: 'Admin 2', password: setup.password, confirm: setup.password })
  expect((await f.req('/api/invitations', { email: 'evil@aurora.test', role: 'owner' }, owner)).status).toBe(403)
  expect((await f.req('/api/invitations', { email: 'evil@aurora.test', role: 'admin' }, admin.cookie)).status).toBe(403)
  f.failMail(); expect((await invite('failed@aurora.test')).status).toBe(502)
  expect((await f.req('/api/invitations', undefined, owner)).body.invitations.at(-1).status).toBe('failed')
})

it('recovers interrupted sends and rejects invitations from disabled administrators', async () => {
  const f = await fixture(), owner = (await f.req('/api/setup', setup)).cookie
  await f.req('/api/invitations', { email: 'crash@aurora.test' }, owner)
  const oldToken = token(f.mail.at(-1)), file = path.join(f.dir, 'org.json'), org = JSON.parse(readFileSync(file, 'utf8'))
  org.invitations[0].status = 'sending'; writeFileSync(file, JSON.stringify(org)); f.reopen()
  expect((await f.req('/api/invitations/inspect', { token: oldToken })).status).toBe(410)
  expect((await f.req('/api/invitations', { email: 'crash@aurora.test' }, owner)).status).toBe(201)
  await f.req('/api/invitations', { email: 'admin@aurora.test', role: 'admin' }, owner)
  const admin = await f.req('/api/invitations/accept', { token: token(f.mail.at(-1)), email: 'admin@aurora.test', name: 'Admin', password: setup.password, confirm: setup.password })
  await f.req('/api/invitations', { email: 'member@aurora.test' }, admin.cookie)
  const memberToken = token(f.mail.at(-1))
  expect((await f.req('/api/members/' + admin.body.user.id, { disabled: true }, owner, 'PATCH')).status).toBe(200)
  expect((await f.req('/api/invitations/inspect', { token: memberToken })).status).toBe(410)
})
it('cannot bypass setup protection with an incomplete environment bootstrap', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'corp-bootstrap-')); dirs.push(dir)
  expect(() => createCorp({ dataDir: dir, disableCrmScheduler: true, disableGithubScheduler: true, env: { KEEPMIND_CORP_MODE: 'server', KEEPMIND_CORP_PUBLIC_URL: 'https://corp.example.com', KEEPMIND_CORP_EMAIL_DOMAINS: 'example.com', KEEPMIND_CORP_OWNER_EMAIL: 'owner@example.com' } })).toThrow('SETUP_TOKEN')
})

it('requires verified invited identities for SSO and rejects changed subject bindings', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test' }
  let identity: any = { email: 'stranger@aurora.test', email_verified: true, sub: 'stranger' }
  const signed = () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ iss: 'https://idp.test', aud: 'corp', exp: Math.floor(Date.now()/1000)+600, ...identity })).toString('base64url')
    const signer = createSign('RSA-SHA256'); signer.update(header + '.' + payload); signer.end()
    return header + '.' + payload + '.' + signer.sign(privateKey).toString('base64url')
  }
  const f = await fixture({ oidc: { issuer: 'https://idp.test', clientId: 'corp', clientSecret: 'synthetic', redirectUri: 'https://unused.test/callback', adminGroup: 'admins' }, fetchImpl: async (url: string) => new Response(JSON.stringify(url.endsWith('openid-configuration') ? { authorization_endpoint: 'https://idp.test/auth', token_endpoint: 'https://idp.test/token', jwks_uri: 'https://idp.test/jwks' } : url.endsWith('/token') ? { id_token: signed() } : { keys: [jwk] }), { status: 200 }) })
  await f.req('/api/setup', setup)
  const callback = async () => {
    const start = await fetch(f.url + '/api/oidc/start', { redirect: 'manual' })
    const state = new URL(start.headers.get('location')!).searchParams.get('state')
    return fetch(f.url + '/api/oidc/callback?code=test&state=' + state, { redirect: 'manual' })
  }
  expect((await callback()).status).toBe(403)
  identity = { email: setup.email, email_verified: false, sub: 'owner-sub' }
  expect((await callback()).status).toBe(403)
  identity.email_verified = true; expect((await callback()).status).toBe(302)
  identity.sub = 'changed-sub'; expect((await callback()).status).toBe(403)
})
