import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, cpSync, chmodSync } from 'node:fs'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'

export interface AiProviderConfig {
  provider: 'local' | 'anthropic' | 'claude-oauth' | 'openai' | 'codex' | 'gemini' | 'grok' | 'ollama'
  apiKey?: string
  model?: string
  baseUrl?: string // for ollama/local/custom endpoints
}

export interface LocalLlmConfig {
  modelId?: string       // e.g. 'qwen2.5-3b'
  modelPath?: string     // absolute path to .gguf
  port?: number          // llama-server port (default 8765)
  downloadedBytes?: number
  totalBytes?: number
  embedModelId?: string  // embedding model for semantic memory (RAG)
}

export interface GitHubConfig {
  encryptionEnabled?: boolean
  accessToken?: string
  refreshToken?: string
  login?: string
  repoOwner?: string
  repoName?: string
  repoUrl?: string
  defaultBranch?: string
  syncRoot?: string // repo prefix mirrored into memory/ — 'memory/' default, '' = whole repo (imported vaults)
  obfuscatePaths?: boolean // push memory files under HMAC-hashed remote names so the repo doesn't disclose vault structure
}

export interface McpServerConfig {
  id: string
  name: string
  kind: 'whatsapp' | 'telegram' | 'postgres' | 'custom'
  enabled: boolean
  // custom / npx servers
  command?: string
  args?: string[]
  env?: Record<string, string>
  // bundled servers
  sessionDir?: string
  // connector permission — 'block' never spawns, 'ask' waits for manual
  // connect, 'allow'/undefined may auto-start
  permission?: 'allow' | 'ask' | 'block'
}

export interface Automation {
  id: string
  name: string
  instruction: string          // what the brain should do (natural language)
  kind: 'brain' | 'sleep' | 'summary' | 'librarian' | 'evolve' | 'enrich' | 'review' | 'security' | 'skills' | 'triage' | 'briefing' | 'escalate' | 'compact' | 'gaps'
  schedule: 'daily' | 'interval' | 'weekly'
  time?: string                // 'HH:MM' for daily/weekly
  everyMinutes?: number        // for interval
  weekday?: number             // 0=Sun..6=Sat for weekly
  enabled: boolean
  mode?: 'auto' | 'approval'  // 'approval' = scheduled runs queue for user OK
  webhook?: boolean          // expose POST /hook/<id> trigger
  webhookToken?: string      // shared secret for the webhook (server-generated)
  lastRunAt?: string
  lastSummary?: string       // one-line result of the last run, shown in the UI
  createdAt: string
}

export interface PendingApproval {
  id: string
  automationId: string
  name: string
  kind: Automation['kind']
  instruction: string
  createdAt: string
}

export interface AuthConfig {
  sessionToken?: string
  googleClientId?: string
  googleClientSecret?: string
}

export interface CorpSyncConfig {
  baseUrl?: string
  token?: string
  enabled?: boolean
  intervalMinutes?: number
  lastPullAt?: string | null
  lastPushAt?: string | null
  lastStatus?: string
}

export interface AppConfig {
  onboardingDone: boolean
  ai: AiProviderConfig
  localLlm: LocalLlmConfig
  github: GitHubConfig
  corpSync?: CorpSyncConfig
  mcpServers: McpServerConfig[]
  agents: AgentPersona[]
  automations: Automation[]
  pendingApprovals: PendingApproval[]
  auth: AuthConfig
  hooks: { lan: boolean }    // webhook listener: localhost-only vs LAN
  memoryDir?: string
  background?: boolean       // keep services (sync/crons/MCP) alive when window closes
  launchAtLogin?: boolean    // open KeepMind at OS login
  autonomy?: 'supervised' | 'autopilot' | 'autonomous' // supervised=approval queues; autopilot=crons run free; autonomous=+health self-applies daily
  vaultTasksTriaged?: boolean // one-shot flag (userData only): vault checkbox→tasks import already ran; survives vault cleanup so archived tasks never re-import
  security?: VaultSecurityConfig
}

// At-rest vault encryption. `sealedKey` is the scrypt-derived AES-256 key,
// sealed by the local keyfile (never synced, never leaves userData).
// `salt` exists for auditability/rotation; the passphrase itself is never stored.
export interface VaultSecurityConfig {
  enabled?: boolean
  categories?: string[]      // top-level vault dirs whose .md files are encrypted
  salt?: string              // hex — scrypt salt used to derive sealedKey
  sealedKey?: string         // hex key, sealed via enc2: envelope
}

export interface AgentPersona {
  id: string
  name: string
  emoji: string
  persona: string // system-prompt style description
  builtin?: boolean
}

// Single-brain model: the app is a memory/learning engine, not a persona
// switcher. Specialist personas were removed — the LLM itself is pluggable.
const DEFAULT_AGENTS: AgentPersona[] = [
  { id: 'brain', name: 'KeepMind', emoji: '🧠', persona: 'You are the user\'s second brain — a persistent, learning memory engine. You know everything they connected: apps, memory tiers, entities, insights. Be warm, concise and insightful. Prefer grounding answers in memory (use get_memory / save_memory). Write what matters to long-term memory. Answer in the user\'s language.', builtin: true }
]

function defaultConfig(): AppConfig {
  return {
    onboardingDone: false,
    ai: { provider: 'local', model: 'qwen2.5-3b' },
    localLlm: {},
    github: {},
    mcpServers: [
      { id: 'postgres', name: 'Postgres (read-only)', kind: 'postgres', enabled: false }
    ],
    agents: DEFAULT_AGENTS,
    hooks: { lan: false },
    background: true,
    // Self-learning defaults: nightly sleep, morning summary, weekly
    // librarian hygiene, weekly evolution review, nightly note enrichment.
    automations: [
      {
        id: 'sleep-nightly', name: 'Nightly sleep cycle',
        instruction: 'Review the day and distill durable memory.',
        kind: 'sleep', schedule: 'daily', time: '23:00',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'summary-morning', name: 'Morning summary',
        instruction: 'Recap yesterday and brief the day.',
        kind: 'summary', schedule: 'daily', time: '08:00',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'librarian-weekly', name: 'Weekly librarian',
        instruction: 'Weekly vault hygiene: consolidate old logs, dedupe long-term memory, refresh entity pages.',
        kind: 'librarian', schedule: 'weekly', weekday: 1, time: '09:00',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'evolve-weekly', name: 'Weekly evolution',
        instruction: 'Review the brain\'s own reports and propose upgrades to sleep questions, memory structure and automations.',
        kind: 'evolve', schedule: 'weekly', weekday: 0, time: '18:00',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'enrich-nightly', name: 'Nightly note enrichment',
        instruction: 'Enrich recent notes with summaries, topic tags and entity wikilinks.',
        kind: 'enrich', schedule: 'daily', time: '02:30',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'briefing-morning', name: 'Morning briefing',
        instruction: 'Write the daily briefing from tasks, goals and recent notes.',
        kind: 'briefing', schedule: 'daily', time: '08:05',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'escalate-morning', name: 'Task escalation',
        instruction: 'Surface overdue and high-priority tasks.',
        kind: 'escalate', schedule: 'daily', time: '08:05',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'compact-nightly', name: 'Compact long-term memory',
        instruction: 'Drop duplicate lines and keep long-term files inside the prompt budget.',
        kind: 'compact', schedule: 'daily', time: '23:20',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'review-evening', name: 'Human review queue',
        instruction: 'Put due flashcards on Today for the person to grade.',
        kind: 'review', schedule: 'daily', time: '20:00',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'gaps-friday', name: 'Close search gaps',
        instruction: 'Match unanswered searches to files already in memory and mark the ones that now resolve.',
        kind: 'gaps', schedule: 'weekly', weekday: 5, time: '18:00',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'security-weekly', name: 'Weekly security audit',
        instruction: 'Scan memory for leaked secrets without printing values.',
        kind: 'security', schedule: 'weekly', weekday: 1, time: '09:30',
        enabled: true, createdAt: new Date().toISOString()
      }
    ],
    auth: {},
    pendingApprovals: []
  }
}

// ── Secret sealing: sensitive fields are encrypted at rest via the OS
// keychain (Electron safeStorage) before hitting config.json. Values are
// stored as "enc:<base64>"; plaintext legacy values still load fine.
// Fail closed when OS encryption is unavailable.

const SECRET_PREFIX = 'enc:'      // legacy: Electron safeStorage (keychain)
const LOCAL_PREFIX = 'enc2:'      // local keyfile AES-256-GCM — survives app updates/re-signing

// Local keyfile: 32 random bytes stored next to config.json with 0600 perms.
// safeStorage's keychain identity is tied to the code signature — every
// unsigned rebuild/re-sign can orphan previously sealed secrets, which is
// why GitHub tokens kept "disappearing". The keyfile is deterministic
// across updates; both config.json and the key stay in userData (never synced).
const secretKeyCache = new Map<string, Buffer>()
function secretKey(dir: string): Buffer | null {
  const cached = secretKeyCache.get(dir)
  if (cached) return cached
  try {
    const keyFile = join(dir, '.secret-key')
    if (existsSync(keyFile)) {
      const k = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex')
      if (k.length === 32) { secretKeyCache.set(dir, k); return k }
      return null // Never replace a corrupt existing key and orphan sealed secrets.
    }
    const k = randomBytes(32)
    writeFileSync(keyFile, k.toString('hex'), { mode: 0o600, flag: 'wx' })
    chmodSync(keyFile, 0o600)
    secretKeyCache.set(dir, k)
    return k
  } catch { return null }
}

function sealLocal(v: string, key: Buffer): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(v, 'utf8'), c.final()])
  return LOCAL_PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}

function unsealLocal(v: string, key: Buffer): string {
  const raw = Buffer.from(v.slice(LOCAL_PREFIX.length), 'base64')
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}

function sealValue(v: unknown, key: Buffer | null): unknown {
  if (typeof v !== 'string' || !v) return v
  if (key) { try { return sealLocal(v, key) } catch { /* fall through */ } }
  if (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text') {
    try { return SECRET_PREFIX + safeStorage.encryptString(v).toString('base64') } catch { /* noop */ }
  }
  throw new Error('Secure storage is unavailable; settings were not saved.')
}

function unsealValue(v: unknown, key: Buffer | null): unknown {
  if (typeof v !== 'string') return v
  if (v.startsWith(LOCAL_PREFIX) && key) {
    try { return unsealLocal(v, key) } catch { return undefined } // key lost/corrupt → unrecoverable
  }
  if (v.startsWith(LOCAL_PREFIX)) return undefined
  if (v.startsWith(SECRET_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(v.slice(SECRET_PREFIX.length), 'base64'))
    } catch { return undefined } // safeStorage identity lost (re-signed build) → treat as unset
  }
  return v
}

function sealConfig(c: AppConfig, key: Buffer | null): AppConfig {
  const out = JSON.parse(JSON.stringify(c)) as AppConfig
  out.ai.apiKey = sealValue(out.ai.apiKey, key) as string | undefined
  out.github.accessToken = sealValue(out.github.accessToken, key) as string | undefined
  out.github.refreshToken = sealValue(out.github.refreshToken, key) as string | undefined
  out.auth.sessionToken = sealValue(out.auth.sessionToken, key) as string | undefined
  out.auth.googleClientSecret = sealValue(out.auth.googleClientSecret, key) as string | undefined
  for (const s of out.mcpServers ?? []) {
    if (s.env) for (const k of Object.keys(s.env)) s.env[k] = sealValue(s.env[k], key) as string
  }
  if (out.security?.sealedKey) {
    out.security = { ...out.security, sealedKey: sealValue(out.security.sealedKey, key) as string | undefined }
  }
  return out
}

function unsealConfig(c: AppConfig, key: Buffer | null): AppConfig {
  const out = JSON.parse(JSON.stringify(c)) as AppConfig
  out.ai.apiKey = unsealValue(out.ai.apiKey, key) as string | undefined
  out.github.accessToken = unsealValue(out.github.accessToken, key) as string | undefined
  out.github.refreshToken = unsealValue(out.github.refreshToken, key) as string | undefined
  out.auth.sessionToken = unsealValue(out.auth.sessionToken, key) as string | undefined
  out.auth.googleClientSecret = unsealValue(out.auth.googleClientSecret, key) as string | undefined
  for (const s of out.mcpServers ?? []) {
    if (s.env) for (const k of Object.keys(s.env)) s.env[k] = unsealValue(s.env[k], key) as string
  }
  if (out.security?.sealedKey) {
    out.security = { ...out.security, sealedKey: unsealValue(out.security.sealedKey, key) as string | undefined }
  }
  return out
}

export class Store {
  private config: AppConfig
  private file: string

  constructor() {
    const dir = join(app.getPath('userData'), 'second-brain')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'config.json')
    this.migrateLegacy(dir)
    this.config = this.load()
  }

  // One-time migration for installs that ran before the KeepMind rename:
  // those builds stored everything under the "second-brain" userData dir.
  // If we have no config yet, adopt the legacy config, auth db and memory.
  private migrateLegacy(dir: string) {
    if (existsSync(this.file)) return
    const legacy = join(app.getPath('userData'), '..', 'second-brain', 'second-brain')
    if (legacy === dir || !existsSync(join(legacy, 'config.json'))) return
    try {
      copyFileSync(join(legacy, 'config.json'), this.file)
      const legacyAuth = join(legacy, 'auth.db')
      if (existsSync(legacyAuth)) copyFileSync(legacyAuth, join(dir, 'auth.db'))
      const legacyMemory = join(legacy, 'memory')
      if (existsSync(legacyMemory)) cpSync(legacyMemory, join(dir, 'memory'), { recursive: true })
    } catch { /* migration is best-effort — fresh install is fine too */ }
  }

  private load(): AppConfig {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'))
        // Discard legacy paid-plan data before merging or saving config.
        delete raw.pro
        const merged = { ...defaultConfig(), ...raw }
        merged.ai = { ...defaultConfig().ai, ...raw.ai }
        merged.localLlm = { ...defaultConfig().localLlm, ...raw.localLlm }
        merged.github = { ...defaultConfig().github, ...raw.github }
        merged.agents = DEFAULT_AGENTS
        // Keep user automations, but seed any new built-in defaults they lack
        const defaults = defaultConfig().automations
        const existing = raw.automations ?? []
        const have = new Set(existing.map((a: Automation) => a.id))
        merged.automations = [...existing, ...defaults.filter(d => !have.has(d.id))]
        merged.pendingApprovals = raw.pendingApprovals ?? []
        merged.auth = { ...defaultConfig().auth, ...raw.auth }
        merged.hooks = { ...defaultConfig().hooks, ...raw.hooks }
        // decrypt secrets only after all merges — raw.* values may still
        // carry the "enc:" envelope from the sealed file
        return unsealConfig(merged, secretKey(dirname(this.file)))
      }
    } catch { /* corrupt config -> defaults */ }
    return defaultConfig()
  }

  get(): AppConfig {
    return this.config
  }

  set(patch: Partial<AppConfig>): AppConfig {
    const next = { ...this.config, ...patch }
    const sealed = sealConfig(next, secretKey(dirname(this.file)))
    writeFileSync(this.file, JSON.stringify(sealed, null, 2), { encoding: 'utf8', mode: 0o600 })
    this.config = next
    return this.config
  }

  updateAi(patch: Partial<AiProviderConfig>) {
    return this.set({ ai: { ...this.config.ai, ...patch } })
  }

  updateLocalLlm(patch: Partial<LocalLlmConfig>) {
    return this.set({ localLlm: { ...this.config.localLlm, ...patch } })
  }

  updateGithub(patch: Partial<GitHubConfig>) {
    return this.set({ github: { ...this.config.github, ...patch } })
  }

  updateCorpSync(patch: Partial<CorpSyncConfig>) {
    return this.set({ corpSync: { ...(this.config.corpSync ?? {}), ...patch } })
  }

  updateMcpServer(id: string, patch: Partial<McpServerConfig>) {
    const mcpServers = this.config.mcpServers.map(s => s.id === id ? { ...s, ...patch } : s)
    return this.set({ mcpServers })
  }

  get memoryDir(): string {
    return this.config.memoryDir ?? join(app.getPath('userData'), 'second-brain', 'memory')
  }

  get isConfigured(): boolean {
    const aiOk = this.config.ai.provider === 'local' || !!this.config.ai.apiKey
    return !!(this.config.github.repoUrl && aiOk)
  }
}
