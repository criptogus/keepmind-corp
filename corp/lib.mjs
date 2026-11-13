// KeepMind Corp policy, vault partitions and scans.
// Secret and PII patterns mirror src/main/services/redact.ts and
// src/main/services/security.ts. This process does not import the
// Electron app. A hit never includes the matched text.

import { createHash, randomBytes, scryptSync, timingSafeEqual, createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync, renameSync, existsSync } from 'node:fs'
import path from 'node:path'
import { sharedRuleFor, peopleRuleFor, ruleAllows, normalizeSharedAccess, normalizePeopleAccess } from './abac.mjs'

export const CORP_VERSION = '0.8.0'
export const ROLES = ['owner', 'admin', 'member', 'auditor']
export const AUTONOMY = ['supervised', 'autopilot', 'autonomous']
export const PROVIDERS = ['local', 'ollama', 'openai', 'anthropic', 'gemini', 'grok']
export const MAGIC = 'KMS1\n'
const MAX_HITS = 200
const MAX_SCAN_BYTES = 1024 * 1024

export const SECRET_PATTERNS = [
  ['openai/generic api key', /\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,})\b/],
  ['github token', /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{30,}|ghu_[A-Za-z0-9]{30,}|ghs_[A-Za-z0-9]{30,}|ghr_[A-Za-z0-9]{30,})\b/],
  ['slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['aws key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['bearer token', /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['stripe key', /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}\b/],
  ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['password assignment', /(?:password|passwd|pwd|secret|api[_-]?key|token|client[_-]?secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/i]
]

export const PII_PATTERNS = [
  ['cpf', /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g],
  ['cnpj', /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['phone', /(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,3}\)[ .-]?|\b\d{2,3}[ .-])\d{4,5}[ .-]?\d{4}\b/g]
]

const ACTIONS = {
  'policy.read': ['owner', 'admin', 'auditor', 'member'],
  'policy.write': ['owner', 'admin'],
  'members.read': ['owner', 'admin'],
  'members.write': ['owner', 'admin'],
  'owner.grant': ['owner'],
  'teams.write': ['owner', 'admin'],
  'agents.write': ['owner', 'admin'],
  'audit.read': ['owner', 'admin', 'auditor'],
  'scan.read': ['owner', 'admin', 'auditor'],
  'scan.paths': ['owner', 'admin'],
  'sync_tokens.read': ['owner', 'admin'],
  'sync_tokens.write': ['owner', 'admin']
}

const SHADOW_KEY = /^(api[_-]?key|apikey|secret|token|password|passwd|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)$/i

export function can(role, action) {
  const allowed = ACTIONS[action]
  if (!allowed) return false
  return allowed.includes(role)
}

export function actions() {
  return Object.keys(ACTIONS)
}

export function autonomyRank(mode) {
  const i = AUTONOMY.indexOf(mode)
  if (i < 0) {
    const err = new Error('Unknown autonomy mode.')
    err.code = 'bad_autonomy'
    throw err
  }
  return i
}

export function hashPassword(password, salt = randomBytes(16)) {
  const hash = scryptSync(password, salt, 32)
  return { salt: salt.toString('hex'), hash: hash.toString('hex') }
}

export function verifyPassword(password, saltHex, hashHex) {
  if (typeof password !== 'string' || typeof saltHex !== 'string' || typeof hashHex !== 'string') return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  if (salt.length === 0 || expected.length === 0) return false
  const actual = scryptSync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function userIdFromEmail(email, taken) {
  const base = String(email).toLowerCase().split('@')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'user'
  let id = base
  let n = 2
  while (taken.has(id)) {
    id = `${base}-${n}`
    n += 1
  }
  return id
}

export function safeRel(rel) {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 240 || rel.includes('\0')) return null
  const norm = path.posix.normalize(rel.replace(/\\/g, '/')).replace(/^(\.\/)+/, '')
  if (!norm || norm === '.' || norm.startsWith('/') || norm.startsWith('../') || norm === '..') return null
  const parts = norm.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..' || part.startsWith('.'))) return null
  return norm
}

export function resolveInside(root, rel) {
  const clean = safeRel(rel)
  if (!clean) return null
  const rootAbs = path.resolve(root)
  const abs = path.resolve(rootAbs, clean)
  const back = path.relative(rootAbs, abs)
  if (back.startsWith('..') || path.isAbsolute(back)) return null
  return { rel: clean, abs }
}

export function partitionOf(rel) {
  const clean = safeRel(rel)
  if (!clean) return { kind: 'denied' }
  if (clean === 'shared' || clean.startsWith('shared/')) return { kind: 'shared' }
  const person = clean.match(/^people\/([a-z0-9][a-z0-9-]{0,40})(?:\/|$)/)
  if (person) return { kind: 'person', id: person[1] }
  if (clean === 'ops' || clean.startsWith('ops/')) return { kind: 'ops' }
  return { kind: 'denied' }
}

export function canReadFile(role, userId, rel, accessCtx = {}) {
  const crmTeam = String(rel).match(/^shared\/crm\/teams\/([^/]+)\//)
  if (crmTeam) return crmTeam[1] === accessCtx.teamId
  const crmPerson = String(rel).match(/^people\/([^/]+)\/memory\/crm\//)
  if (crmPerson) return crmPerson[1] === userId
  const part = partitionOf(rel)
  if (part.kind === 'denied') return false
  if (role === 'owner' || role === 'admin') return true
  if (part.kind === 'shared') {
    const rule = sharedRuleFor(rel, accessCtx.sharedAccess)
    if (rule) return ruleAllows(rule, { role, title: accessCtx.title, teamId: accessCtx.teamId })
    return role === 'member' || role === 'auditor'
  }
  if (part.kind === 'person') {
    if (role === 'member' && part.id === userId) return true
    const rule = peopleRuleFor(rel, accessCtx.peopleAccess)
    if (rule && role === 'member') return ruleAllows(rule, { role, title: accessCtx.title, teamId: accessCtx.teamId })
    return false
  }
  if (part.kind === 'ops') return role === 'auditor'
  return false
}

export function canWriteFile(role, userId, rel) {
  if (/(?:^|\/)crm\/relationships\.md$/.test(String(rel).replace(/\\/g, '/'))) return false
  const part = partitionOf(rel)
  if (!part || part.kind === 'denied' || part.kind === 'ops') return false
  if (!rel.endsWith('.md')) return false
  if (role === 'owner' || role === 'admin') return part.kind === 'shared' || part.kind === 'person'
  if (role === 'member') return part.kind === 'person' && part.id === userId
  return false
}

export function assertNoShadowKeys(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoShadowKeys(item)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (SHADOW_KEY.test(key)) {
      const err = new Error('Provider keys stay in the organization environment. Personal keys are not stored.')
      err.code = 'shadow_key'
      throw err
    }
    assertNoShadowKeys(child)
  }
}

export function defaultPolicy() {
  return {
    providers: ['local', 'ollama'],
    byokRequired: true,
    memberKeys: false,
    autonomyCeiling: 'supervised',
    retentionDays: 365,
    residency: 'customer-vpc',
    sharedAccess: [],
    peopleAccess: [],
    cloudAllowed: false
  }
}

export function normalizePolicy(input, prev = defaultPolicy()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const err = new Error('Policy must be an object.')
    err.code = 'bad_policy'
    throw err
  }
  assertNoShadowKeys(input)
  if (input.memberKeys === true || input.byokRequired === false) {
    const err = new Error('KeepMind Corp requires organization BYOK. Members cannot keep a personal provider key.')
    err.code = 'shadow_key'
    throw err
  }
  const providers = Array.isArray(input.providers)
    ? [...new Set(input.providers.filter(item => PROVIDERS.includes(item)))]
    : prev.providers
  const autonomyCeiling = AUTONOMY.includes(input.autonomyCeiling) ? input.autonomyCeiling : prev.autonomyCeiling
  const parsedDays = Number(input.retentionDays)
  const retentionDays = Number.isFinite(parsedDays)
    ? Math.max(7, Math.min(3650, Math.round(parsedDays)))
    : prev.retentionDays
  const residency = typeof input.residency === 'string' && input.residency.trim()
    ? input.residency.trim().slice(0, 80)
    : prev.residency
  return {
    providers,
    byokRequired: true,
    memberKeys: false,
    autonomyCeiling,
    retentionDays,
    residency,
    sharedAccess: normalizeSharedAccess(
      Array.isArray(input.sharedAccess) ? input.sharedAccess : prev.sharedAccess
    ),
    peopleAccess: normalizePeopleAccess(
      Array.isArray(input.peopleAccess) ? input.peopleAccess : prev.peopleAccess
    ),
    cloudAllowed: providers.some(item => item !== 'local' && item !== 'ollama')
  }
}

export function accessCtxForUser(user, org) {
  return {
    title: user.title,
    teamId: user.teamId,
    sharedAccess: normalizeSharedAccess(org.policy?.sharedAccess),
    peopleAccess: normalizePeopleAccess(org.policy?.peopleAccess)
  }
}

export function clampTeamAutonomy(requested, ceiling) {
  if (!AUTONOMY.includes(requested)) {
    const err = new Error('Unknown autonomy mode.')
    err.code = 'bad_autonomy'
    throw err
  }
  if (autonomyRank(requested) > autonomyRank(ceiling)) {
    const err = new Error(`Team autonomy cannot pass the organization ceiling (${ceiling}).`)
    err.code = 'above_ceiling'
    throw err
  }
  return requested
}

function countMatches(re, line) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  const copy = new RegExp(re.source, flags)
  return line.match(copy)?.length ?? 0
}

export function scanText(rel, raw) {
  const secrets = []
  const pii = []
  if (typeof raw !== 'string') return { encrypted: false, skipped: true, secrets, pii }
  if (raw.startsWith(MAGIC)) return { encrypted: true, skipped: false, secrets, pii }
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const [label, re] of SECRET_PATTERNS) {
      if (countMatches(re, line) > 0) {
        secrets.push({ path: rel, line: i + 1, label })
        break
      }
    }
    for (const [label, re] of PII_PATTERNS) {
      const n = countMatches(re, line)
      for (let j = 0; j < n; j++) pii.push({ path: rel, line: i + 1, label })
    }
  }
  return { encrypted: false, skipped: false, secrets, pii }
}

export function redactSecrets(text) {
  let out = text
  for (const [, re] of SECRET_PATTERNS) {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
    out = out.replace(new RegExp(re.source, flags), '⟨redacted:secret⟩')
  }
  return out
}

export function walkMarkdown(root) {
  const files = []
  const visit = (dir, relBase) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(abs, rel)
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push({ rel, abs })
    }
  }
  visit(path.resolve(root), '')
  return files
}

export function scanVault(root) {
  const secrets = []
  const pii = []
  const byLabel = {}
  const piiByLabel = {}
  let encryptedFiles = 0
  let skipped = 0
  for (const file of walkMarkdown(root)) {
    let raw = ''
    try {
      const size = statSync(file.abs).size
      if (size > MAX_SCAN_BYTES) {
        skipped += 1
        continue
      }
      raw = readFileSync(file.abs, 'utf8')
    } catch {
      skipped += 1
      continue
    }
    const found = scanText(file.rel, raw)
    if (found.encrypted) {
      encryptedFiles += 1
      continue
    }
    for (const hit of found.secrets) {
      byLabel[hit.label] = (byLabel[hit.label] ?? 0) + 1
      if (secrets.length < MAX_HITS) secrets.push(hit)
    }
    for (const hit of found.pii) {
      piiByLabel[hit.label] = (piiByLabel[hit.label] ?? 0) + 1
      if (pii.length < MAX_HITS) pii.push(hit)
    }
  }
  return {
    secrets,
    pii,
    byLabel,
    piiByLabel,
    secretTotal: Object.values(byLabel).reduce((sum, n) => sum + n, 0),
    piiTotal: Object.values(piiByLabel).reduce((sum, n) => sum + n, 0),
    encryptedFiles,
    skipped
  }
}

export function publicScan(scan, withPaths) {
  const base = {
    secretTotal: scan.secretTotal,
    piiTotal: scan.piiTotal,
    byLabel: scan.byLabel,
    piiByLabel: scan.piiByLabel,
    encryptedFiles: scan.encryptedFiles,
    skipped: scan.skipped
  }
  if (!withPaths) return base
  return { ...base, secrets: scan.secrets, pii: scan.pii }
}

/** Add new catalog agents (e.g. composer) to existing org.json without dropping custom rows. */
export function mergeTeamCatalog(loaded, baseTeams) {
  const byId = new Map((Array.isArray(loaded) ? loaded : []).map((t) => [t.id, t]))
  return baseTeams.map((def) => {
    const cur = byId.get(def.id)
    if (!cur) return { ...def }
    return {
      ...def,
      ...cur,
      budgetDaily: cur.budgetDaily !== undefined ? cur.budgetDaily : def.budgetDaily,
      usageToday: cur.usageToday ?? def.usageToday ?? 0,
      usageDay: cur.usageDay ?? def.usageDay ?? null
    }
  })
}

export function mergeAgentCatalog(loaded, baseAgents) {
  const byId = new Map((Array.isArray(loaded) ? loaded : []).map((a) => [a.id, a]))
  return baseAgents.map((def) => {
    const cur = byId.get(def.id)
    if (!cur) return { ...def }
    return {
      ...def,
      ...cur,
      kind: cur.kind ?? def.kind,
      description: cur.description ?? def.description,
      quotaDaily: cur.quotaDaily !== undefined ? cur.quotaDaily : def.quotaDaily,
      usageToday: cur.usageToday ?? def.usageToday ?? 0,
      usageDay: cur.usageDay ?? def.usageDay ?? null
    }
  })
}

export function defaultOrg(name = 'KeepMind Corp') {
  return {
    version: 1,
    name,
    users: [],
    teams: [{
      id: 'everyone',
      name: 'Everyone',
      autonomy: 'supervised',
      budgetDaily: 10000,
      usageToday: 0,
      usageDay: null
    }],
    agents: [
      { id: 'brain', name: 'Brain', enabled: false, teamId: 'everyone', autonomyMax: 'supervised', kind: 'builtin', description: 'Chat e RAG do second brain corporativo', quotaDaily: 2000, usageToday: 0, usageDay: null },
      { id: 'composer', name: 'Cursor Composer', enabled: false, teamId: 'everyone', autonomyMax: 'supervised', kind: 'app', description: 'Agente Cursor com MCP KeepMind (sb_search, sb_remember)', quotaDaily: 500, usageToday: 0, usageDay: null },
      { id: 'ingest', name: 'Ingest', enabled: false, teamId: 'everyone', autonomyMax: 'supervised', kind: 'builtin', description: 'Captura e ingestão de notas', quotaDaily: 300, usageToday: 0, usageDay: null },
      { id: 'sync', name: 'Sync', enabled: false, teamId: 'everyone', autonomyMax: 'supervised', kind: 'builtin', description: 'Sincronização com repositório externo', quotaDaily: null, usageToday: 0, usageDay: null }
    ],
    policy: defaultPolicy()
  }
}

export function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function b64urlDecode(segment) {
  return Buffer.from(segment, 'base64url')
}

export function verifyRs256(token, { issuer, audience, jwks, now = Math.floor(Date.now() / 1000) }) {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3) fail('bad_token', 'Identity token is not a JWT.')
  let header
  let payload
  try {
    header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'))
    payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'))
  } catch {
    fail('bad_token', 'Identity token could not be read.')
  }
  if (!header || header.alg !== 'RS256') fail('bad_token', 'Only RS256 identity tokens are accepted.')
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : []
  const jwk = keys.find(key => key && key.kty === 'RSA' && (!header.kid || key.kid === header.kid))
  if (!jwk) fail('bad_token', 'No matching signing key.')
  let ok = false
  try {
    const pub = createPublicKey({ key: jwk, format: 'jwk' })
    ok = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), pub, b64urlDecode(parts[2]))
  } catch {
    ok = false
  }
  if (!ok) fail('bad_token', 'Identity token signature was rejected.')
  const iss = String(issuer || '').replace(/\/$/, '')
  if (String(payload.iss || '').replace(/\/$/, '') !== iss) fail('bad_token', 'Identity token issuer does not match.')
  const aud = payload.aud
  const audOk = Array.isArray(aud) ? aud.includes(audience) : aud === audience
  if (!audOk) fail('bad_token', 'Identity token audience does not match.')
  if (typeof payload.exp === 'number' && payload.exp < now) fail('bad_token', 'Identity token expired.')
  return payload
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}

export function ensureVaultShape(vault) {
  mkdirSync(path.join(vault, 'shared'), { recursive: true })
  mkdirSync(path.join(vault, 'people'), { recursive: true })
  mkdirSync(path.join(vault, 'ops'), { recursive: true })
  const welcome = path.join(vault, 'shared', 'welcome.md')
  if (!existsSync(welcome)) {
    writeFileSync(welcome, [
      '# Company vault',
      '',
      'Personal memory lives in `people/<id>/`.',
      'What the company shares lives in `shared/`.',
      'The desktop KeepMind app is a separate product and does not read this vault.',
      ''
    ].join('\n'))
  }
}

export function appendAudit(vault, entry) {
  const file = path.join(vault, 'ops', 'activity.jsonl')
  mkdirSync(path.dirname(file), { recursive: true })
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry })
  appendFileSync(file, `${line}\n`)
}

export function readAudit(vault, limit) {
  const file = path.join(vault, 'ops', 'activity.jsonl')
  if (!existsSync(file)) return []
  const raw = readFileSync(file, 'utf8')
  const lines = raw.trim().split('\n').filter(Boolean).slice(-Math.max(1, Math.min(200, limit)))
  const rows = []
  for (const line of lines) {
    try { rows.push(JSON.parse(line)) } catch { /* skip a torn line */ }
  }
  return rows.reverse()
}

export function sha256(value) {
  return createHash('sha256').update(value).digest()
}

function fail(code, message) {
  const err = new Error(message)
  err.code = code
  throw err
}
