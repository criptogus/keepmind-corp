// KeepMind Corp — corporate second brain (web) + organization governance.
// Same KeepMind UI at /brain/ with policy enforcement; admins use /admin/.

import { workspaceConfig, createWorkspace, smtpMailer, secretMatches } from './workspace.mjs'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, createReadStream, createWriteStream, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CORP_VERSION,   ROLES, PROVIDERS, AUTONOMY,
  can, hashPassword, verifyPassword, userIdFromEmail,
  resolveInside, canReadFile, canWriteFile, normalizePolicy, accessCtxForUser,
  clampTeamAutonomy, scanText, scanVault, publicScan, redactSecrets, walkMarkdown,
  defaultOrg, readJson, writeJsonAtomic, ensureVaultShape, appendAudit, readAudit,
  verifyRs256
} from './lib.mjs'
import { createOidc, oidcFromEnv } from './oidc.mjs'
import { mountBrainApi, listCorpMemoryFiles } from './brain-api.mjs'
import { mountMcpApi } from './mcp-api.mjs'
import { assertNoSymlinkPath } from '../tools/lib/continuity.mjs'
import { mountCrmApi, startCrmScheduler } from './crm-api.mjs'
import { ensureUserBrain } from './memory-layout.mjs'
import { orgSecretStatus, setOrgSecrets, getOrgSecret } from './org-secrets.mjs'
import { setLlmSecrets, llmSecretStatus, getLlmSecret } from './llm-secrets.mjs'
import { streamVaultBackup } from './vault-backup.mjs'
import { readOidcVaultConfig, oidcVaultStatus, writeOidcVaultConfig, clearOidcVaultConfig } from './oidc-store.mjs'
import { listSyncTokens, createSyncToken, revokeSyncToken, resolveSyncBearer } from './sync-tokens-store.mjs'
import { loadOrg } from './org-persist.mjs'
import { meteringSnapshot } from './team-usage.mjs'
import { readGithubSync, writeGithubSync } from './github-sync-store.mjs'
import { runGithubSync } from './github-sync.mjs'
import { byokReport } from './byok-meter.mjs'
import { auditExportNdjson, auditExportCsv } from './audit-export.mjs'
import { startGithubSyncScheduler } from './github-sync-scheduler.mjs'
import { verifyGithubHookSecret } from './github-sync-store.mjs'

const CORP_ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(CORP_ROOT, 'public')
const BRAIN_DIR = path.join(CORP_ROOT, 'brain-dist')
const SESSION_MS = 12 * 60 * 60 * 1000
const MAX_BODY = 64 * 1024
const STATIC = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/login.js': 'login.js',
  '/login.css': 'login.css',
  '/onboarding.css': 'onboarding.css',
  '/admin': 'admin.html',
  '/admin/': 'admin.html',
  '/admin.html': 'admin.html',
  '/admin-app.js': 'admin-app.js',
  '/app.css': 'app.css'
}

export function createCorp(opts = {}) {
  const env = opts.env ?? process.env
  const workspaceSettings = workspaceConfig(env)
  const dataDir = opts.dataDir ?? env.KEEPMIND_CORP_DATA ?? path.join(process.cwd(), 'corp', 'data')
  const vault = opts.vault ?? env.KEEPMIND_VAULT ?? path.join(dataDir, 'vault')
  mkdirSync(dataDir, { recursive: true })
  ensureVaultShape(vault)
  const orgFile = path.join(dataDir, 'org.json')
  const sessionFile = path.join(dataDir, 'sessions.json')
  const org = loadOrg(orgFile, env.KEEPMIND_CORP_ORG_NAME || 'KeepMind Corp')
  const sessions = new Map(Object.entries(readJson(sessionFile, {})))
  const failures = new Map()
  const publicAttempts = new Map()
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  let oidc = null
  function refreshOidc() {
    if (opts.oidc === false) {
      oidc = null
      return null
    }
    const cfg = opts.oidc !== undefined ? opts.oidc : (readOidcVaultConfig(vault) || oidcFromEnv(env))
    oidc = cfg ? createOidc(cfg, fetchImpl) : null
    return oidc
  }
  refreshOidc()
  const secureCookie = workspaceSettings.secure
  const sameOriginMutation = req => {
    if (!workspaceSettings.server) return legacySameOriginMutation(req)
    if (['GET', 'HEAD'].includes(req.method)) return true
    return req.headers.origin === workspaceSettings.origin
  }

  const brainApi = mountBrainApi({
    vault,
    getOrg: () => org,
    audit: (user, op, extra) => audit(user, op, extra),
    persistOrg
  })
  const crmApi = mountCrmApi({ vault, getOrg: () => org, persistOrg, audit: (user, op, extra) => audit(user, op, extra) })
  const mcpApi = mountMcpApi({
    vault,
    getOrg: () => org,
    audit: (user, op, extra) => audit(user, op, extra),
    persistOrg,
    memoryFilesForUser: listCorpMemoryFiles
  })

  if (!org.crmNamespace) org.crmNamespace = randomBytes(16).toString('hex')
  const workspace = createWorkspace({ org, config: workspaceSettings, persist: persistOrg, addUser, audit, mailer: opts.mailer ?? smtpMailer(env), now: opts.now })
  ensureOwner(env)
  if (workspaceSettings.server && !org.users.some(u => u.role === 'owner') && String(env.KEEPMIND_CORP_SETUP_TOKEN || '').length < 32) throw Error('Initial server setup requires a random KEEPMIND_CORP_SETUP_TOKEN of at least 32 characters.')
  persistOrg()
  if (!opts.disableCrmScheduler) startCrmScheduler(vault, () => org)
  if (!opts.disableGithubScheduler) {
    startGithubSyncScheduler(vault, {
      audit: (actor, op, extra) => appendAudit(vault, { actor, role: 'system', op, ...extra })
    })
  }

  function persistOrg() {
    writeJsonAtomic(orgFile, org)
    const policyFile = path.join(vault, 'ops', 'corp-policy.json')
    writeJsonAtomic(policyFile, {
      edition: 'keepmind-corp',
      version: CORP_VERSION,
      org: org.name,
      policy: org.policy,
      teams: org.teams,
      agents: org.agents.map(agent => ({ id: agent.id, name: agent.name, enabled: agent.enabled, teamId: agent.teamId }))
    })
  }

  function persistSessions() {
    const live = {}
    const now = Date.now()
    for (const [token, row] of sessions) {
      if (row.exp > now) live[token] = row
      else sessions.delete(token)
    }
    writeJsonAtomic(sessionFile, live)
  }

  function ensureOwner(source) {
    if (org.users.some(user => user.role === 'owner')) return
    const email = String(source.KEEPMIND_CORP_OWNER_EMAIL || '').trim().toLowerCase()
    const password = String(source.KEEPMIND_CORP_OWNER_PASSWORD || '')
    if (!email || !password) return
    if (!validEmail(email) || password.length < 12 || (workspaceSettings.server && !workspace.allowed(email))) {
      console.error('KeepMind Corp owner bootstrap needs a valid email and a password of at least 12 characters.')
      return
    }
    addUser({ email, name: 'Owner', role: 'owner', teamId: 'everyone', password })
  }

  function addUser({ email, name, role, teamId, password, oidcSub }) {
    const id = userIdFromEmail(email, new Set(org.users.map(user => user.id)))
    const secret = password ? hashPassword(password) : null
    const user = {
      id,
      email,
      name: String(name || email).slice(0, 80),
      title: '',
      role,
      teamId: org.teams.some(team => team.id === teamId) ? teamId : 'everyone',
      disabled: false,
      onboardingDone: false,
      oidcSub: oidcSub || null,
      passwordSalt: secret?.salt ?? null,
      passwordHash: secret?.hash ?? null
    }
    org.users.push(user)
    ensureUserBrain(vault, id, user.name)
    return user
  }

  function publicUser(user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      title: user.title || '',
      role: user.role,
      teamId: user.teamId,
      disabled: !!user.disabled
    }
  }

  function userFromToken(token) {
    if (!token) return null
    const row = sessions.get(token)
    if (!row || row.exp < Date.now()) {
      sessions.delete(token)
      return null
    }
    const user = org.users.find(item => item.id === row.userId && !item.disabled)
    return user ?? null
  }

  function openSession(user) {
    const token = randomBytes(32).toString('hex')
    sessions.set(token, { userId: user.id, exp: Date.now() + SESSION_MS })
    persistSessions()
    return token
  }

  function cookie(token) {
    const parts = [`kmcorp=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.floor(SESSION_MS / 1000)}`]
    if (secureCookie) parts.push('Secure')
    return parts.join('; ')
  }

  function clearCookie() {
    return 'kmcorp=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
  }

  function audit(actor, op, extra = {}) {
    appendAudit(vault, { actor: actor?.email ?? 'system', role: actor?.role ?? 'system', op, ...extra })
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://corp.local')
      res.setHeader('Referrer-Policy', 'no-referrer')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (workspaceSettings.server && req.headers.host !== new URL(workspaceSettings.origin).host) return send(res, 400, { ok: false, error: 'invalid_host' })
      if (workspaceSettings.server && req.method === 'POST' && ['/api/setup','/api/login','/api/invitations/inspect','/api/invitations/accept'].includes(url.pathname)) {
        const key = `${clientIp(req)}|${url.pathname}`, now = Date.now()
        const entry = publicAttempts.get(key)
        const recent = entry && entry.until > now ? entry : { count: 0, until: now + 600000 }
        if (++recent.count > 60) return send(res, 429, { ok: false, error: 'rate_limited', message: 'Muitas tentativas. Aguarde alguns minutos.' })
        if (publicAttempts.size >= 10000) publicAttempts.delete(publicAttempts.keys().next().value)
        publicAttempts.set(key, recent)
      }
      if (STATIC[url.pathname] && (req.method === 'GET' || req.method === 'HEAD')) {
        return sendFile(res, STATIC[url.pathname], req.method === 'HEAD')
      }
      const tokenEarly = readCookie(req, 'kmcorp')
      const userEarly = userFromToken(tokenEarly)
      if (url.pathname === '/brain' || url.pathname.startsWith('/brain/')) {
        if (!userEarly) {
          res.writeHead(302, { Location: '/' })
          res.end()
          return
        }
        return serveBrainApp(res, url, req.method === 'HEAD')
      }
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204)
        res.end()
        return
      }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return send(res, 200, { ok: true, edition: 'keepmind-corp', version: CORP_VERSION })
      }
      if (url.pathname === '/api/hooks/github-sync' && req.method === 'POST') {
        return await githubSyncHook(req, res)
      }
      if (url.pathname === '/api/meta' && req.method === 'GET') {
        return send(res, 200, {
          ok: true,
          edition: 'keepmind-corp',
          version: CORP_VERSION,
          org: org.name,
          serverMode: workspaceSettings.server,
          invitationDomains: workspaceSettings.domains,
          oidc: !!oidc,
          setupRequired: !org.users.some(user => user.role === 'owner'),
          providers: PROVIDERS,
          autonomy: AUTONOMY,
          roles: ROLES
        })
      }
      if (url.pathname === '/api/oidc/start' && req.method === 'GET') return await oidcStart(res)
      if (url.pathname === '/api/oidc/callback' && req.method === 'GET') return await oidcCallback(url, res)
      const relMatch = url.pathname.match(/^\/releases\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9._() \-]+))?\/?$/)
      if (relMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        return await serveRelease(req, res, relMatch[1], relMatch[2] ? decodeURIComponent(relMatch[2]) : null, vault)
      }
      const token = readCookie(req, 'kmcorp')
      let user = userFromToken(token)
      const bearer = parseBearerToken(req)
      const syncCtx = bearer ? resolveSyncBearer(vault, bearer) : null
      let syncAuth = false
      if (!user && syncCtx) {
        const bind = org.users.find((item) => item.id === syncCtx.userId && !item.disabled)
        if (bind) {
          user = bind
          syncAuth = true
        }
      }
      if (url.pathname === '/api/session' && req.method === 'GET') {
        return send(res, 200, { ok: true, user: user ? publicUser(user) : null, orgNamespace: org.crmNamespace })
      }
      if (url.pathname === '/api/invitations/inspect' && req.method === 'POST') {
        if (!sameOriginMutation(req)) return send(res, 403, { ok: false, error: 'forbidden' })
        return send(res, 200, { ok: true, invitation: workspace.inspect((await readBody(req)).token) })
      }
      if (url.pathname === '/api/invitations/accept' && req.method === 'POST') {
        if (!sameOriginMutation(req)) return send(res, 403, { ok: false, error: 'forbidden' })
        const accepted = workspace.accept(await readBody(req))
        res.setHeader('Set-Cookie', cookie(openSession(accepted)))
        return send(res, 201, { ok: true, user: publicUser(accepted) })
      }
      if (url.pathname === '/api/setup' && req.method === 'POST') return await firstSetup(req, res)
      if (url.pathname === '/api/login' && req.method === 'POST') return await login(req, res)
      if (url.pathname === '/api/logout' && req.method === 'POST') return logout(req, token, res)
      if (!user) return send(res, 401, { ok: false, error: 'unauthorized' })
      const syncRoute = syncAuth && syncTokenAllows(url, req.method, syncCtx)
      if (syncRoute && !['/api/client-config', '/api/llm/token'].includes(url.pathname) && !org.agents.find((a) => a.id === 'sync' && a.enabled)) {
        return send(res, 403, { ok: false, error: 'sync_off', message: 'Ative o agente Sync em Agentes.' })
      }
      if (!syncRoute && !sameOriginMutation(req)) return send(res, 403, { ok: false, error: 'forbidden' })
      if (await crmApi(req, res, url, user, syncAuth ? syncCtx : null)) return
      if (await brainApi(req, res, url, user, syncAuth ? syncCtx : null)) return
      if (await mcpApi(req, res, url, user, syncAuth ? syncCtx : null)) return
      if (url.pathname === '/api/llm/token' && req.method === 'GET') {
        if (syncAuth && !(syncCtx?.scopes || []).includes('llm:read')) {
          return send(res, 403, { ok: false, error: 'forbidden', message: 'Token sem escopo llm:read.' })
        }
        const provider = String(url.searchParams.get('provider') || '').trim()
        const key = getLlmSecret(vault, provider, user)
        if (!key) return send(res, 404, { ok: false, error: 'not_found', message: 'No LLM key configured for this provider and scope.' })
        audit(user, 'llm_token_fetch', { provider, viaSync: syncAuth, tokenId: syncCtx?.tokenId })
        return send(res, 200, { ok: true, provider, key })
      }
      if (url.pathname === '/api/client-config' && req.method === 'GET') {
        if (syncAuth && !['mcp:read', 'mcp:invoke', 'llm:read'].some((sc) => (syncCtx?.scopes || []).includes(sc))) {
          return send(res, 403, { ok: false, error: 'forbidden', message: 'Token sem escopo de cliente.' })
        }
        return send(res, 200, {
          ok: true,
          org: org.name,
          edition: 'keepmind-corp',
          role: user.role,
          providers: org.policy.providers,
          autonomyCeiling: org.policy.autonomyCeiling,
          githubRepo: 'https://github.com/criptogus/keepmind-os',
          downloads: bearer ? `/releases/${bearer}/` : null
        })
      }
      if (syncAuth) return send(res, 403, { ok: false, error: 'forbidden', message: 'Token válido só para export/import/MCP.' })
      return await authed(req, res, url, user)
    } catch (err) {
      const code = err.code || 'server_error'
      const status = err.status ?? STATUS[code] ?? 500
      if (status === 500) console.error(err)
      return send(res, status, { ok: false, error: code, message: status === 500 ? 'Something went wrong.' : err.message })
    }
  }

  async function firstSetup(req, res) {
    if (!sameOriginMutation(req)) return send(res, 403, { ok: false, error: 'forbidden' })
    if (org.users.some(user => user.role === 'owner')) {
      return send(res, 409, { ok: false, error: 'setup_done', message: 'A conta de dono já existe.' })
    }
    const body = await readBody(req)
    // Recheck after reading the body: two concurrent setup requests cannot create two owners.
    if (org.users.some(user => user.role === 'owner')) return send(res, 409, { ok: false, error: 'setup_done' })
    if (workspaceSettings.server && !secretMatches(body.setupToken || '', env.KEEPMIND_CORP_SETUP_TOKEN || '')) return send(res, 403, { ok: false, error: 'setup_token', message: 'Chave de instalação inválida. Consulte o responsável pelo servidor.' })
    const orgName = String(body.orgName || '').trim().slice(0, 80)
    const name = String(body.name || '').trim().slice(0, 80)
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const confirm = String(body.confirm || '')
    if (!orgName) return send(res, 400, { ok: false, error: 'bad_org', message: 'Informe o nome da empresa.' })
    if (!name) return send(res, 400, { ok: false, error: 'bad_name', message: 'Informe seu nome.' })
    if (!validEmail(email) || (workspaceSettings.server && !workspace.allowed(email))) return send(res, 400, { ok: false, error: 'bad_email', message: 'Use um e-mail do domínio corporativo configurado no servidor.' })
    if (password.length < 12 || password.length > 1024) {
      return send(res, 400, { ok: false, error: 'weak_password', message: 'Use uma senha com pelo menos 12 caracteres.' })
    }
    if (password !== confirm) {
      return send(res, 400, { ok: false, error: 'mismatch', message: 'As senhas não conferem.' })
    }
    org.name = orgName
    const user = addUser({ email, name, role: 'owner', teamId: 'everyone', password })
    persistOrg()
    audit(user, 'setup_complete', { org: orgName })
    const issued = openSession(user)
    res.setHeader('Set-Cookie', cookie(issued))
    return send(res, 201, { ok: true, user: publicUser(user) })
  }

  async function login(req, res) {
    if (workspaceSettings.server && !sameOriginMutation(req)) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const key = `${clientIp(req)}|${email}`
    const now = Date.now()
    const prior = failures.get(key) || []
    const recent = prior.filter(ts => now - ts < 10 * 60 * 1000)
    if (recent.length >= 8) return send(res, 429, { ok: false, error: 'rate_limited' })
    const user = org.users.find(item => item.email === email && !item.disabled)
    if (!user?.passwordHash || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      recent.push(now)
      failures.set(key, recent)
      audit(null, 'login_failed', { email })
      return send(res, 401, { ok: false, error: 'bad_login' })
    }
    failures.delete(key)
    ensureUserBrain(vault, user.id, user.name)
    const issued = openSession(user)
    audit(user, 'login')
    res.setHeader('Set-Cookie', cookie(issued))
    return send(res, 200, { ok: true, user: publicUser(user) })
  }

  function logout(req, token, res) {
    if (!sameOriginMutation(req)) return send(res, 403, { ok: false, error: 'forbidden' })
    if (token) sessions.delete(token)
    persistSessions()
    res.setHeader('Set-Cookie', clearCookie())
    return send(res, 200, { ok: true })
  }

  async function oidcStart(res) {
    if (!oidc) return send(res, 404, { ok: false, error: 'oidc_off' })
    const location = await oidc.start()
    res.writeHead(302, { Location: location })
    res.end()
  }

  async function oidcCallback(url, res) {
    if (!oidc) return send(res, 404, { ok: false, error: 'oidc_off' })
    const state = url.searchParams.get('state') || ''
    const code = url.searchParams.get('code') || ''
    const pending = oidc.take(state)
    if (!pending || !code) return send(res, 400, { ok: false, error: 'bad_token', message: 'Sign-in session expired.' })
    const exchanged = await oidc.exchange(code, pending.verifier)
    const payload = verifyRs256(exchanged.idToken, {
      issuer: oidc.config.issuer,
      audience: oidc.config.clientId,
      jwks: exchanged.jwks
    })
    const email = String(payload.email || '').trim().toLowerCase()
    if (!validEmail(email)) return send(res, 400, { ok: false, error: 'bad_user', message: 'The identity token has no email.' })
    if (workspaceSettings.server && (payload.email_verified !== true || !workspace.allowed(email) || !org.users.some(u => u.email === email && !u.disabled))) return send(res, 403, { ok: false, error: 'invitation_required', message: 'Aceite um convite do workspace antes de usar SSO.' })
    const groups = Array.isArray(payload.groups) ? payload.groups.map(String) : []
    const ssoAdmin = groups.includes(oidc.config.adminGroup)
    let user = org.users.find(item => workspaceSettings.server ? item.email === email : (item.oidcSub === payload.sub || item.email === email))
    if (workspaceSettings.server && user?.oidcSub && user.oidcSub !== payload.sub) return send(res, 403, { ok: false, error: 'forbidden' })
    if (!user) {
      user = addUser({
        email,
        name: payload.name || email,
        role: ssoAdmin ? 'admin' : 'member',
        teamId: 'everyone',
        oidcSub: String(payload.sub || '')
      })
      persistOrg()
      audit(user, 'member_joined', { via: 'oidc' })
    } else if (user.disabled) {
      return send(res, 403, { ok: false, error: 'forbidden' })
    } else {
      user.oidcSub = String(payload.sub || user.oidcSub || '')
      if (ssoAdmin && user.role === 'member') user.role = 'admin'
      persistOrg()
    }
    const issued = openSession(user)
    audit(user, 'login', { via: 'oidc' })
    ensureUserBrain(vault, user.id, user.name)
    res.writeHead(302, { Location: '/brain/', 'Set-Cookie': cookie(issued) })
    res.end()
  }

  async function authed(req, res, url, user) {
    if (url.pathname === '/api/invitations' && ['GET', 'POST'].includes(req.method)) {
      if (!can(user.role, 'members.write')) return send(res, 403, { ok: false, error: 'forbidden' })
      if (req.method === 'GET') return send(res, 200, { ok: true, invitations: workspace.list() })
      return send(res, 201, { ok: true, invitation: await workspace.invite(user, await readBody(req)) })
    }
    if (url.pathname.startsWith('/api/invitations/') && req.method === 'DELETE') {
      workspace.revoke(user, url.pathname.slice('/api/invitations/'.length))
      return send(res, 200, { ok: true })
    }
    if (url.pathname === '/api/me' && req.method === 'GET') {
      return send(res, 200, { ok: true, user: publicUser(user), org: org.name })
    }
    if (url.pathname === '/api/overview' && req.method === 'GET') return overview(res, user)
    if (url.pathname === '/api/policy' && req.method === 'GET') {
      if (!can(user.role, 'policy.read')) return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, policy: org.policy })
    }
    if (url.pathname === '/api/policy' && req.method === 'PUT') return writePolicy(req, res, user)
    if (url.pathname === '/api/org-secrets' && req.method === 'GET') {
      if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, ...orgSecretStatus(vault) })
    }
    if (url.pathname === '/api/org-secrets' && req.method === 'PUT') return writeOrgSecrets(req, res, user)
    if (url.pathname === '/api/llm-secrets' && req.method === 'GET') {
      if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, secrets: llmSecretStatus(vault) })
    }
    if (url.pathname === '/api/llm-secrets' && req.method === 'PUT') return writeLlmSecrets(req, res, user)
    if (url.pathname === '/api/oidc-config' && req.method === 'GET') {
      if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, ...oidcVaultStatus(vault), active: !!oidc })
    }
    if (url.pathname === '/api/oidc-config' && req.method === 'PUT') return writeOidcConfig(req, res, user)
    if (url.pathname === '/api/oidc-config' && req.method === 'DELETE') return deleteOidcConfig(req, res, user)
    if (url.pathname === '/api/backup' && req.method === 'GET') return vaultBackup(req, res, user)
    if (url.pathname === '/api/teams' && req.method === 'GET') {
      return send(res, 200, { ok: true, teams: org.teams, ceiling: org.policy.autonomyCeiling })
    }
    if (url.pathname === '/api/teams' && req.method === 'PUT') return writeTeams(req, res, user)
    if (url.pathname === '/api/members' && req.method === 'GET') {
      if (!can(user.role, 'members.read')) return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, members: org.users.map(publicUser) })
    }
    if (url.pathname === '/api/members' && req.method === 'POST') return createMember(req, res, user)
    if (url.pathname.startsWith('/api/members/') && req.method === 'PATCH') {
      return patchMember(req, res, user, decodeURIComponent(url.pathname.slice('/api/members/'.length)))
    }
    if (url.pathname === '/api/agents' && req.method === 'GET') {
      return send(res, 200, { ok: true, agents: org.agents })
    }
    if (url.pathname === '/api/agents' && req.method === 'PUT') return writeAgents(req, res, user)
    if (url.pathname === '/api/audit' && req.method === 'GET') {
      if (!can(user.role, 'audit.read')) return send(res, 403, { ok: false, error: 'forbidden' })
      const limit = Number(url.searchParams.get('limit') || 50)
      return send(res, 200, { ok: true, entries: readAudit(vault, limit) })
    }
    if (url.pathname === '/api/audit/export' && req.method === 'GET') return auditExportRoute(req, res, user, url)
    if (url.pathname === '/api/scan' && req.method === 'GET') {
      if (!can(user.role, 'scan.read')) return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, scan: publicScan(scanVault(vault), can(user.role, 'scan.paths')) })
    }
    if (url.pathname === '/api/files' && req.method === 'GET') return listFiles(res, user)
    if (url.pathname === '/api/files/preview' && req.method === 'GET') {
      return previewFile(res, user, url.searchParams.get('path') || '')
    }
    if (url.pathname === '/api/files' && req.method === 'POST') return writeFile(req, res, user)
    if (url.pathname === '/api/releases' && req.method === 'GET') return listReleasesRoute(res, vault)
    if (url.pathname === '/api/releases' && req.method === 'POST') return uploadReleaseRoute(req, res, user, url, vault, audit)
    if (url.pathname.startsWith('/api/releases/') && req.method === 'DELETE') {
      return deleteReleaseRoute(res, decodeURIComponent(url.pathname.slice('/api/releases/'.length)), user, vault, audit)
    }
    if (url.pathname === '/api/sync-tokens' && req.method === 'GET') return listSyncTokensRoute(res, user)
    if (url.pathname === '/api/sync-tokens' && req.method === 'POST') return mintSyncTokenRoute(req, res, user)
    if (url.pathname.startsWith('/api/sync-tokens/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.slice('/api/sync-tokens/'.length))
      return revokeSyncTokenRoute(res, user, id)
    }
    if (url.pathname === '/api/metering' && req.method === 'GET') return meteringRoute(res, user)
    if (url.pathname === '/api/github-sync' && req.method === 'GET') return githubSyncGet(res, user)
    if (url.pathname === '/api/github-sync' && req.method === 'PUT') return githubSyncPut(req, res, user)
    if (url.pathname === '/api/github-sync/run' && req.method === 'POST') return githubSyncRun(req, res, user)
    if (url.pathname === '/api/byok-report' && req.method === 'GET') return byokReportRoute(res, user, url)
    return send(res, 404, { ok: false, error: 'not_found' })
  }

  function meteringRoute(res, user) {
    if (!can(user.role, 'policy.read')) return send(res, 403, { ok: false, error: 'forbidden' })
    return send(res, 200, { ok: true, ...meteringSnapshot(org) })
  }

  function githubSyncGet(res, user) {
    if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    return send(res, 200, { ok: true, config: readGithubSync(vault), hasToken: Boolean(getOrgSecret(vault, 'github')) })
  }

  async function githubSyncPut(req, res, user) {
    if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const config = writeGithubSync(vault, {
      enabled: !!body.enabled,
      owner: body.owner,
      repo: body.repo,
      branch: body.branch || 'main',
      repoPrefix: body.repoPrefix || 'corp-vault',
      scheduleEnabled: !!body.scheduleEnabled,
      intervalMinutes: Number(body.intervalMinutes) || 60,
      hookSecret: body.hookSecret
    })
    audit(user, 'github_sync_config', { enabled: config.enabled, repo: `${config.owner}/${config.repo}` })
    return send(res, 200, { ok: true, config })
  }

  async function githubSyncRun(req, res, user) {
    if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const direction = body.direction === 'push' || body.direction === 'pull' ? body.direction : 'both'
    try {
      const result = await runGithubSync(vault, direction)
      audit(user, 'github_sync_run', { pushed: result.pushed, pulled: result.pulled })
      return send(res, 200, { ok: true, ...result })
    } catch (err) {
      return send(res, 400, { ok: false, error: err.code || 'github_error', message: err.message })
    }
  }

  function byokReportRoute(res, user, url) {
    if (!can(user.role, 'policy.read')) return send(res, 403, { ok: false, error: 'forbidden' })
    const days = Number(url.searchParams.get('days') || 30)
    return send(res, 200, { ok: true, report: byokReport(vault, days) })
  }

  function auditExportRoute(req, res, user, url) {
    if (!can(user.role, 'audit.read')) return send(res, 403, { ok: false, error: 'forbidden' })
    const format = String(url.searchParams.get('format') || 'ndjson').toLowerCase()
    const limit = Number(url.searchParams.get('limit') || 500)
    const since = url.searchParams.get('since') || undefined
    const body = format === 'csv' ? auditExportCsv(vault, { limit, since }) : auditExportNdjson(vault, { limit, since })
    res.writeHead(200, {
      'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson',
      'content-disposition': `attachment; filename="keepmind-audit.${format === 'csv' ? 'csv' : 'ndjson'}"`,
      'cache-control': 'no-store'
    })
    res.end(body)
    audit(user, 'audit_export', { format, limit })
    return true
  }

  async function githubSyncHook(req, res) {
    const secret = req.headers['x-keepmind-hook'] || req.headers['x-github-sync-secret']
    if (!verifyGithubHookSecret(vault, secret)) {
      return send(res, 403, { ok: false, error: 'forbidden' })
    }
    try {
      const result = await runGithubSync(vault, 'both')
      appendAudit(vault, { actor: 'ci', role: 'system', op: 'github_sync_hook', ...result })
      return send(res, 200, { ok: true, ...result })
    } catch (err) {
      return send(res, 400, { ok: false, error: err.code || 'github_error', message: err.message })
    }
  }

  function listSyncTokensRoute(res, user) {
    if (!can(user.role, 'sync_tokens.read')) return send(res, 403, { ok: false, error: 'forbidden' })
    const rows = listSyncTokens(vault).map((row) => ({
      ...row,
      userEmail: org.users.find((u) => u.id === row.userId)?.email ?? row.userId
    }))
    return send(res, 200, { ok: true, tokens: rows })
  }

  async function mintSyncTokenRoute(req, res, user) {
    if (!can(user.role, 'sync_tokens.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const label = String(body.label || 'desktop-sync').slice(0, 40)
    const userId = String(body.userId || user.id).trim()
    const bind = org.users.find((u) => u.id === userId && !u.disabled)
    if (!bind) return send(res, 400, { ok: false, error: 'bad_user', message: 'Pessoa inválida.' })
    const minted = createSyncToken(vault, { label, userId, createdBy: user.id, scopes: Array.isArray(body.scopes) ? body.scopes : undefined })
    audit(user, 'sync_token_mint', { tokenId: minted.id, userId })
    return send(res, 201, {
      ok: true,
      token: {
        id: minted.id,
        label: minted.label,
        secret: minted.secret,
        scopes: minted.scopes,
        userId: minted.userId
      }
    })
  }

  function revokeSyncTokenRoute(res, user, id) {
    if (!can(user.role, 'sync_tokens.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    if (!id) return send(res, 400, { ok: false, error: 'bad_token' })
    if (!revokeSyncToken(vault, id)) return send(res, 404, { ok: false, error: 'not_found' })
    audit(user, 'sync_token_revoke', { tokenId: id })
    return send(res, 200, { ok: true })
  }

  function overview(res, user) {
    const scan = can(user.role, 'scan.read')
      ? publicScan(scanVault(vault), can(user.role, 'scan.paths'))
      : null
    const entries = can(user.role, 'audit.read') ? readAudit(vault, 8) : []
    return send(res, 200, {
      ok: true,
      org: org.name,
      user: publicUser(user),
      policy: org.policy,
      teams: org.teams,
      agents: org.agents,
      scan,
      audit: entries,
      memory: 'partitioned'
    })
  }

  async function writePolicy(req, res, user) {
    if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    org.policy = normalizePolicy(body, org.policy)
    for (const team of org.teams) {
      if (AUTONOMY.indexOf(team.autonomy) > AUTONOMY.indexOf(org.policy.autonomyCeiling)) {
        team.autonomy = org.policy.autonomyCeiling
      }
    }
    persistOrg()
    audit(user, 'policy_update', { providers: org.policy.providers, ceiling: org.policy.autonomyCeiling })
    return send(res, 200, { ok: true, policy: org.policy, teams: org.teams })
  }

  function vaultBackup(req, res, user) {
    if (user.role !== 'owner') return send(res, 403, { ok: false, error: 'forbidden' })
    audit(user, 'vault_backup', {})
    streamVaultBackup(vault, res)
    return true
  }

  async function writeOidcConfig(req, res, user) {
    if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    try {
      const status = writeOidcVaultConfig(vault, body)
      refreshOidc()
      audit(user, 'oidc_config_update', { issuer: status.issuer })
      return send(res, 200, { ok: true, ...status, active: !!oidc })
    } catch (err) {
      const code = err.code || 'bad_policy'
      return send(res, 400, { ok: false, error: code, message: err.message })
    }
  }

  async function deleteOidcConfig(req, res, user) {
    if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    if (!sameOriginMutation(req)) return send(res, 403, { ok: false, error: 'forbidden' })
    const status = clearOidcVaultConfig(vault)
    refreshOidc()
    audit(user, 'oidc_config_clear', {})
    return send(res, 200, { ok: true, ...status, active: !!oidc })
  }

  async function writeOrgSecrets(req, res, user) {
    if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const patch = body.providers && typeof body.providers === 'object' ? body.providers : body
    const clean = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value === '' || value === null) clean[key] = ''
      else if (typeof value === 'string') clean[key] = value
    }
    const status = setOrgSecrets(vault, clean)
    audit(user, 'org_secrets_update', { providers: Object.keys(clean) })
    return send(res, 200, { ok: true, ...status })
  }

  async function writeLlmSecrets(req, res, user) {
    if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const entries = Array.isArray(body.entries) ? body.entries : []
    const secrets = setLlmSecrets(vault, entries)
    audit(user, 'llm_secrets_update', { scopes: entries.map((e) => `${e.provider}:${e.scope || 'org'}`) })
    return send(res, 200, { ok: true, secrets })
  }

  async function writeTeams(req, res, user) {
    if (!can(user.role, 'teams.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const incoming = Array.isArray(body.teams) ? body.teams : null
    if (!incoming) {
      const err = new Error('Teams must be a list.')
      err.code = 'bad_policy'
      throw err
    }
    const next = []
    const seen = new Set()
    for (const team of incoming) {
      const id = String(team.id || '').trim()
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) || seen.has(id)) {
        const err = new Error('Each team needs a unique id of letters, numbers and dashes.')
        err.code = 'bad_policy'
        throw err
      }
      seen.add(id)
      const prev = org.teams.find((t) => t.id === id)
      const budgetRaw = team.budgetDaily
      const budgetDaily = budgetRaw === '' || budgetRaw === undefined
        ? (prev?.budgetDaily ?? null)
        : (budgetRaw === null ? null : Number(budgetRaw))
      next.push({
        id,
        name: String(team.name || id).slice(0, 80),
        autonomy: clampTeamAutonomy(team.autonomy, org.policy.autonomyCeiling),
        budgetDaily: Number.isFinite(budgetDaily) ? budgetDaily : (budgetDaily === null ? null : prev?.budgetDaily ?? null),
        usageToday: Number(prev?.usageToday ?? 0),
        usageDay: prev?.usageDay ?? null
      })
    }
    if (!next.some(team => team.id === 'everyone')) {
      next.unshift({
        id: 'everyone',
        name: 'Everyone',
        autonomy: 'supervised',
        budgetDaily: 10000,
        usageToday: 0,
        usageDay: null
      })
    }
    org.teams = next
    for (const member of org.users) {
      if (!org.teams.some(team => team.id === member.teamId)) member.teamId = 'everyone'
    }
    persistOrg()
    audit(user, 'teams_update', { teams: org.teams.map(team => team.id) })
    return send(res, 200, { ok: true, teams: org.teams })
  }

  async function createMember(req, res, user) {
    if (workspaceSettings.server) return send(res, 409, { ok: false, error: 'invitation_required', message: 'Envie um convite; cada pessoa define a própria senha.' })
    if (!can(user.role, 'members.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const email = String(body.email || '').trim().toLowerCase()
    const role = body.role || 'member'
    const password = String(body.password || '')
    if (!validEmail(email) || org.users.some(item => item.email === email)) {
      const err = new Error('Use a new, valid email.')
      err.code = 'bad_user'
      throw err
    }
    if (!ROLES.includes(role)) {
      const err = new Error('Unknown role.')
      err.code = 'bad_user'
      throw err
    }
    if (role === 'owner' && !can(user.role, 'owner.grant')) {
      return send(res, 403, { ok: false, error: 'forbidden' })
    }
    if (password.length < 12 || password.length > 1024) {
      const err = new Error('Passwords need at least 12 characters.')
      err.code = 'bad_user'
      throw err
    }
    const created = addUser({
      email,
      name: body.name,
      role,
      teamId: body.teamId || 'everyone',
      password
    })
    if (body.title) created.title = String(body.title).slice(0, 80)
    persistOrg()
    audit(user, 'member_create', { email, role })
    return send(res, 201, { ok: true, member: publicUser(created) })
  }

  async function patchMember(req, res, user, id) {
    if (!can(user.role, 'members.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const target = org.users.find(item => item.id === id)
    if (!target) return send(res, 404, { ok: false, error: 'not_found' })
    const body = await readBody(req)
    if (body.role && body.role !== target.role) {
      if (workspaceSettings.server && body.role === 'admin' && user.role !== 'owner') return send(res, 403, { ok: false, error: 'forbidden' })
      if (!ROLES.includes(body.role)) {
        const err = new Error('Unknown role.')
        err.code = 'bad_user'
        throw err
      }
      if ((body.role === 'owner' || target.role === 'owner') && !can(user.role, 'owner.grant')) {
        return send(res, 403, { ok: false, error: 'forbidden' })
      }
      if (target.role === 'owner' && body.role !== 'owner') {
        const owners = org.users.filter(item => item.role === 'owner' && !item.disabled)
        if (owners.length <= 1) {
          const err = new Error('The last owner stays an owner.')
          err.code = 'last_owner'
          throw err
        }
      }
      target.role = body.role
    }
    if (typeof body.disabled === 'boolean') {
      if (target.role === 'owner' && body.disabled) {
        const owners = org.users.filter(item => item.role === 'owner' && !item.disabled && item.id !== target.id)
        if (owners.length === 0) {
          const err = new Error('The last owner stays an owner.')
          err.code = 'last_owner'
          throw err
        }
      }
      target.disabled = body.disabled
    }
    if (body.teamId && org.teams.some(team => team.id === body.teamId)) target.teamId = body.teamId
    if (body.name) target.name = String(body.name).slice(0, 80)
    if (body.title !== undefined) target.title = String(body.title || '').slice(0, 80)
    persistOrg()
    audit(user, 'member_update', { id: target.id, role: target.role, disabled: !!target.disabled })
    return send(res, 200, { ok: true, member: publicUser(target) })
  }

  async function writeAgents(req, res, user) {
    if (!can(user.role, 'agents.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const incoming = Array.isArray(body.agents) ? body.agents : null
    if (!incoming) {
      const err = new Error('Agents must be a list.')
      err.code = 'bad_policy'
      throw err
    }
    const next = []
    const seen = new Set()
    for (const agent of incoming) {
      const id = String(agent.id || '').trim()
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) || seen.has(id)) {
        const err = new Error('Each agent needs a unique id.')
        err.code = 'bad_policy'
        throw err
      }
      seen.add(id)
      const teamId = org.teams.some(team => team.id === agent.teamId) ? agent.teamId : 'everyone'
      const autonomyMax = clampTeamAutonomy(agent.autonomyMax || 'supervised', org.policy.autonomyCeiling)
      const prev = org.agents.find((a) => a.id === id)
      next.push({
        id,
        name: String(agent.name || id).slice(0, 80),
        enabled: !!agent.enabled,
        teamId,
        autonomyMax,
        kind: String(agent.kind || prev?.kind || 'builtin').slice(0, 40),
        description: String(agent.description || prev?.description || '').slice(0, 200),
        quotaDaily: agent.quotaDaily === null || agent.quotaDaily === ''
          ? null
          : (Number(agent.quotaDaily ?? prev?.quotaDaily) || null),
        usageToday: Number(agent.usageToday ?? prev?.usageToday ?? 0),
        usageDay: agent.usageDay ?? prev?.usageDay ?? null
      })
    }
    org.agents = next
    persistOrg()
    audit(user, 'agents_update', { enabled: next.filter(agent => agent.enabled).map(agent => agent.id) })
    return send(res, 200, { ok: true, agents: org.agents })
  }

  function listFiles(res, user) {
    const ctx = accessCtxForUser(user, org)
    const files = scanVaultList().filter(file => canReadFile(user.role, user.id, file.path, ctx))
    return send(res, 200, { ok: true, files })
  }

  function previewFile(res, user, rel) {
    const located = resolveInside(vault, rel)
    if (!located) return send(res, 400, { ok: false, error: 'bad_path' })
    const ctx = accessCtxForUser(user, org)
    if (!canReadFile(user.role, user.id, located.rel, ctx)) return send(res, 403, { ok: false, error: 'forbidden' })
    try { assertNoSymlinkPath(vault, located.rel) } catch { return send(res, 403, { ok: false, error: 'forbidden' }) }
    if (!existsSync(located.abs)) return send(res, 404, { ok: false, error: 'not_found' })
    const raw = readFileSync(located.abs, 'utf8')
    if (raw.startsWith('KMS1\n')) return send(res, 200, { ok: true, path: located.rel, encrypted: true, text: '' })
    return send(res, 200, { ok: true, path: located.rel, encrypted: false, text: redactSecrets(raw).slice(0, 8000) })
  }

  async function writeFile(req, res, user) {
    const body = await readBody(req)
    const located = resolveInside(vault, String(body.path || ''))
    if (!located) return send(res, 400, { ok: false, error: 'bad_path' })
    if (!canWriteFile(user.role, user.id, located.rel)) return send(res, 403, { ok: false, error: 'forbidden' })
    try { assertNoSymlinkPath(vault, located.rel) } catch { return send(res, 403, { ok: false, error: 'forbidden' }) }
    const text = String(body.text ?? '')
    if (text.length > MAX_BODY) return send(res, 400, { ok: false, error: 'bad_path', message: 'Note is too large.' })
    const found = scanText(located.rel, text)
    if (found.secrets.length > 0) {
      audit(user, 'write_blocked', { path: located.rel, label: found.secrets[0].label })
      return send(res, 400, { ok: false, error: 'secret_blocked', message: 'That note contains a credential. It was not saved.' })
    }
    mkdirSync(path.dirname(located.abs), { recursive: true })
    writeFileSync(located.abs, text)
    audit(user, 'write', { path: located.rel })
    return send(res, 200, { ok: true, path: located.rel })
  }

  function scanVaultList() {
    return walkMarkdown(vault).map(file => {
      let encrypted = false
      try {
        const head = readFileSync(file.abs, 'utf8').slice(0, 5)
        encrypted = head === 'KMS1\n'
      } catch { encrypted = false }
      return { path: file.rel, encrypted }
    })
  }

  return { handle, org, vault, dataDir }
}

const STATUS = {
  shadow_key: 400,
  quota_exceeded: 429,
  team_budget_exceeded: 429,
  agent_off: 403,
  bad_agent: 400,
  bad_tool: 400,
  above_ceiling: 400,
  bad_policy: 400,
  bad_autonomy: 400,
  secret_blocked: 400,
  bad_path: 400,
  bad_user: 400,
  bad_token: 400,
  last_owner: 409,
  oidc_down: 502,
  github_off: 400,
  github_error: 502
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function clientIp(req) {
  return req.socket?.remoteAddress || 'local'
}

function readCookie(req, name) {
  const header = req.headers.cookie || ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return ''
}

function legacySameOriginMutation(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  if (req.headers['x-keepmind-corp'] === '1') return true
  const origin = req.headers.origin
  if (!origin) return false
  try {
    const host = new URL(origin).host
    return host === req.headers.host
  } catch {
    return false
  }
}

function parseBearerToken(req) {
  const header = String(req.headers.authorization || '')
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : ''
}

function syncTokenAllows(url, method, ctx) {
  if (!ctx) return false
  const scopes = ctx.scopes || []
  if (method === 'GET' && url.pathname === '/api/brain/export') return scopes.includes('memory:export')
  if (method === 'POST' && url.pathname === '/api/brain/import') return scopes.includes('memory:import')
  const mcpOk = scopes.includes('mcp:invoke') || scopes.includes('mcp:read')
  if (method === 'POST' && url.pathname === '/api/mcp/call') return mcpOk
  if (method === 'GET' && url.pathname === '/api/mcp/tools') return mcpOk
  if (method === 'GET' && url.pathname === '/api/llm/token') return scopes.includes('llm:read')
  if (method === 'GET' && url.pathname === '/api/client-config') return scopes.includes('mcp:read') || scopes.includes('mcp:invoke') || scopes.includes('llm:read')
  return false
}

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(payload)
}

function serveBrainApp(res, url, head) {
  if (!existsSync(BRAIN_DIR)) {
    return send(res, 503, { ok: false, error: 'brain_not_built', message: 'Run npm run corp:build-brain, then reload.' })
  }
  const sub = url.pathname.replace(/^\/brain\/?/, '') || 'index.html'
  let file = path.join(BRAIN_DIR, sub)
  const root = path.resolve(BRAIN_DIR)
  if (!path.resolve(file).startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    file = path.join(BRAIN_DIR, 'index.html')
  }
  const ext = path.extname(file)
  const type = ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/html'
  const body = readFileSync(file)
  const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none';"
  res.writeHead(200, {
    'content-type': `${type}; charset=utf-8`,
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  })
  res.end(head ? undefined : body)
}

const RELEASE_NAME = /^(latest-[A-Za-z0-9-]+\.yml|[A-Za-z0-9][A-Za-z0-9._() \-]{0,120}\.(dmg|zip|exe|AppImage|blockmap|yml))$/
const RELEASE_MAX = 2 * 1024 * 1024 * 1024

function releasesDir(vault) {
  const dir = path.join(vault, 'releases')
  mkdirSync(dir, { recursive: true })
  return dir
}

function serveRelease(req, res, secret, file, vaultRef) {
  return (async () => {
    try {
      const ctx = resolveSyncBearer(vaultRef, secret)
      if (!ctx) return send(res, 404, { ok: false, error: 'not_found' })
      const scopes = ctx.scopes || []
      const allowed = scopes.includes('mcp:read') || scopes.includes('mcp:invoke') || scopes.includes('llm:read')
      if (!allowed) return send(res, 403, { ok: false, error: 'forbidden', message: 'Token sem escopo de cliente.' })
      const dir = releasesDir(vaultRef)
      if (!file) {
        const items = readdirSync(dir).filter(n => RELEASE_NAME.test(n)).sort().map(n => {
          const st = statSync(path.join(dir, n))
          return { name: n, size: st.size }
        })
        const links = items.map(i => `<li><a href="./${encodeURIComponent(i.name)}">${i.name}</a> (${(i.size / 1048576).toFixed(1)} MB)</li>`).join('')
        const body = `<!doctype html><meta charset="utf-8"><title>KeepMind OS — Downloads</title>
<style>body{font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px}a{color:#111}</style>
<h1>KeepMind OS</h1><p>Instaladores disponíveis para download:</p><ul>${links || '<li>Nenhum release publicado ainda.</li>'}</ul>`
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        return res.end(req.method === 'HEAD' ? undefined : body)
      }
      if (!RELEASE_NAME.test(file) || file.includes('..')) return send(res, 404, { ok: false, error: 'not_found' })
      const fp = path.join(dir, file)
      if (!existsSync(fp)) return send(res, 404, { ok: false, error: 'not_found' })
      const type = file.endsWith('.dmg') ? 'application/x-apple-diskimage'
        : file.endsWith('.zip') ? 'application/zip'
        : file.endsWith('.exe') ? 'application/vnd.microsoft.portable-executable'
        : file.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream'
      res.writeHead(200, {
        'content-type': type,
        'content-length': statSync(fp).size,
        'content-disposition': `attachment; filename="${file}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      })
      if (req.method === 'HEAD') return res.end()
      createReadStream(fp).pipe(res)
    } catch (err) {
      send(res, 500, { ok: false, error: 'server_error' })
    }
  })()
}

function listReleasesRoute(res, vault) {
  try {
    const dir = releasesDir(vault)
    const files = readdirSync(dir).filter(n => RELEASE_NAME.test(n)).sort().map(n => {
      const st = statSync(path.join(dir, n))
      return { name: n, size: st.size, mtime: st.mtime.toISOString() }
    })
    send(res, 200, { ok: true, files })
  } catch {
    send(res, 500, { ok: false, error: 'server_error' })
  }
}

async function uploadReleaseRoute(req, res, user, url, vault, auditFn) {
  if (user.role !== 'owner' && user.role !== 'admin') return send(res, 403, { ok: false, error: 'forbidden' })
  const name = String(url.searchParams.get('name') || '')
  if (!RELEASE_NAME.test(name) || name.includes('..')) return send(res, 400, { ok: false, error: 'bad_name' })
  const dir = releasesDir(vault)
  const dest = path.join(dir, name)
  const tmp = `${dest}.part`
  try {
    let size = 0
    await new Promise((resolve, reject) => {
      const out = createWriteStream(tmp)
      req.on('data', c => { size += c.length; if (size > RELEASE_MAX) { out.destroy(); reject(Object.assign(new Error('too large'), { code: 'too_large' })) } })
      req.pipe(out)
      out.on('finish', resolve)
      out.on('error', reject)
      req.on('error', reject)
    })
    const { renameSync } = await import('node:fs')
    renameSync(tmp, dest)
    auditFn(user, 'release_upload', { name, size })
    send(res, 200, { ok: true, name, size })
  } catch (err) {
    try { unlinkSync(tmp) } catch {}
    send(res, err.code === 'too_large' ? 413 : 500, { ok: false, error: err.code || 'server_error' })
  }
}

function deleteReleaseRoute(res, name, user, vault, auditFn) {
  if (user.role !== 'owner' && user.role !== 'admin') return send(res, 403, { ok: false, error: 'forbidden' })
  if (!RELEASE_NAME.test(name) || name.includes('..')) return send(res, 400, { ok: false, error: 'bad_name' })
  const fp = path.join(releasesDir(vault), name)
  if (!existsSync(fp)) return send(res, 404, { ok: false, error: 'not_found' })
  unlinkSync(fp)
  auditFn(user, 'release_delete', { name })
  send(res, 200, { ok: true })
}

function sendFile(res, name, head) {
  const file = path.join(PUBLIC_DIR, name)
  const type = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html'
  const body = readFileSync(file)
  res.writeHead(200, {
    'content-type': `${type}; charset=utf-8`,
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY'
  })
  res.end(head ? undefined : body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body is too large.'), { code: 'bad_path' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(Object.assign(new Error('Body must be JSON.'), { code: 'bad_policy' })) }
    })
    req.on('error', reject)
  })
}

export function startFromEnv() {
  const env = process.env
  const host = env.KEEPMIND_CORP_HOST || '127.0.0.1'
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && env.KEEPMIND_CORP_MODE !== 'server') throw Error('Non-loopback binding requires KEEPMIND_CORP_MODE=server and its public URL/domain configuration.')
  const port = Number(env.KEEPMIND_CORP_PORT || 8787)
  const corp = createCorp({ env })
  const server = createServer((req, res) => {
    corp.handle(req, res).catch(err => {
      console.error(err)
      if (!res.headersSent) send(res, 500, { ok: false, error: 'server_error', message: 'Something went wrong.' })
    })
  })
  server.listen(port, host, () => {
    console.log(`KeepMind Corp ${CORP_VERSION} on http://${host}:${port}`)
  })
  return server
}

const invoked = process.argv[1] && import.meta.url === pathToFile(process.argv[1])
if (invoked) startFromEnv()

function pathToFile(file) {
  return fileURLToPath(import.meta.url) === path.resolve(file) ? import.meta.url : ''
}
