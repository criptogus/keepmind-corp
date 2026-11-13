import { randomBytes, scryptSync } from 'node:crypto'
import { encryptVault, decryptVault } from '../../../tools/lib/vault-crypto.mjs'
import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import type { Store, VaultSecurityConfig } from '../store'
import type { Memory } from './brain'
import { SECRET_PATTERNS } from './redact'
import { chat, type ChatMessage } from './llm'
import type { LocalLlm } from './local-llm'

// ── Vault security: at-rest encryption + risk alerts ──
//
// Encryption model: the user picks a passphrase; we derive an AES-256 key
// with scrypt and seal the *derived key* into config.json via the local
// keyfile envelope (enc2:). The passphrase itself is never stored.
// Encrypted files keep their path/extension but become a utf8-safe blob:
//
//   KMS1\n<base64(iv[12] + authTag[16] + ciphertext)>
//
// GitHub sync carries the ciphertext verbatim — the repo can be public
// without leaking memory content. Memory.read decrypts transparently, so
// every consumer (brain, RAG, skills, graph, agents via MCP) sees plaintext.

const MAGIC = 'KMS1\n'
const MAX_HITS = 200

export function vaultCryptoFor(cfg: VaultSecurityConfig | undefined) {
  const keyHex = cfg?.sealedKey
  if (!keyHex) return null
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) return null
  const cats = new Set((cfg?.categories ?? []).map(c => c.toLowerCase()))
  const enabled = !!cfg?.enabled
  return {
    encryptsPath(rel: string): boolean {
      if (!enabled || !rel.endsWith('.md')) return false
      const top = rel.split('/')[0]?.toLowerCase()
      return !!top && cats.has(top)
    },
    isBlob: (t: string) => t.startsWith(MAGIC),
    encrypt(text: string): string { return encryptVault(text, key) },
    decrypt(blob: string): string { return decryptVault(blob, key) }
  }
}

export function vaultCrypto(store: Store) {
  return vaultCryptoFor(store.get().security)
}

export function attachVaultCrypto(store: Store, memory: Memory) {
  memory.vaultCrypto = vaultCrypto(store)
}

// First bytes of a file without loading it whole — used to detect KMS1
// blobs when counting encrypted files across a large vault.
function readHead(absPath: string, n = 8): string {
  try {
    const fd = openSync(absPath, 'r')
    const buf = Buffer.alloc(n)
    const read = readSync(fd, buf, 0, n, 0)
    closeSync(fd)
    return buf.subarray(0, read).toString('utf8')
  } catch { return '' }
}

function isEncryptedAtRest(memory: Memory, rel: string): boolean {
  try { return readHead(memory.resolve(rel)).startsWith(MAGIC) } catch { return false }
}

export interface SecurityStatus {
  configured: boolean      // a key exists (passphrase was set at least once)
  enabled: boolean         // new writes to selected categories are encrypted
  categories: string[]
  availableCategories: string[]
  encryptedFiles: number
  totalMdFiles: number
}

export async function securityStatus(store: Store, memory: Memory): Promise<SecurityStatus> {
  const cfg = store.get().security ?? {}
  const topDirs = new Map<string, number>()
  let encrypted = 0
  let total = 0
  for (const rel of memory.allRelFiles()) {
    if (!rel.endsWith('.md')) continue
    total++
    const top = rel.split('/')[0]
    if (top) topDirs.set(top, (topDirs.get(top) ?? 0) + 1)
    if (isEncryptedAtRest(memory, rel)) encrypted++
  }
  return {
    configured: !!cfg.sealedKey,
    enabled: !!cfg.enabled,
    categories: cfg.categories ?? [],
    availableCategories: [...topDirs.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d),
    encryptedFiles: encrypted,
    totalMdFiles: total
  }
}

export interface SecretHit {
  path: string
  line: number
  label: string
  encrypted: boolean   // file is ciphertext at rest — lower exposure
}

export interface SecurityScan {
  hits: SecretHit[]
  totalHits: number
  byLabel: Record<string, number>
  unencryptedHits: number
  piiHits: SecretHit[]
  piiTotal: number
  piiByLabel: Record<string, number>
}

// PII detectors ported from the KeepMind security model (PR #1): CPF, CNPJ,
// email and phone formats. Lower severity than credentials — reported
// separately so a contact-heavy vault doesn't drown real secret hits.
const PII_PATTERNS: [string, RegExp][] = [
  ['cpf', /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g],
  ['cnpj', /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['phone', /(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,3}\)[ .-]?|\b\d{2,3}[ .-])\d{4,5}[ .-]?\d{4}\b/g]
]

// Deterministic secret scan — returns file+line+pattern label but NEVER
// the secret value. Same patterns as the outbound redactor.
export async function securityScan(store: Store, memory: Memory): Promise<SecurityScan> {
  const hits: SecretHit[] = []
  const piiHits: SecretHit[] = []
  let totalHits = 0
  let piiTotal = 0
  const byLabel: Record<string, number> = {}
  const piiByLabel: Record<string, number> = {}
  let unencryptedHits = 0
  for (const rel of memory.allRelFiles()) {
    if (!rel.endsWith('.md')) continue
    const content = memory.read(rel) // transparently decrypted
    if (!content || content.startsWith(MAGIC)) continue
    const encrypted = isEncryptedAtRest(memory, rel)
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const [label, re] of SECRET_PATTERNS) {
        re.lastIndex = 0
        if (re.test(line)) {
          totalHits++
          byLabel[label] = (byLabel[label] ?? 0) + 1
          if (!encrypted) unencryptedHits++
          if (hits.length < MAX_HITS) hits.push({ path: rel, line: i + 1, label, encrypted })
          break
        }
      }
      for (const [label, re] of PII_PATTERNS) {
        re.lastIndex = 0
        const n = line.match(re)?.length ?? 0
        for (let j = 0; j < n; j++) {
          piiTotal++
          piiByLabel[label] = (piiByLabel[label] ?? 0) + 1
          if (piiHits.length < MAX_HITS) piiHits.push({ path: rel, line: i + 1, label, encrypted })
        }
      }
    }
  }
  return { hits, totalHits, byLabel, unencryptedHits, piiHits, piiTotal, piiByLabel }
}

// ── Bulk transforms ──
// Bypass Memory.write to avoid journaling thousands of entries; onWrite is
// still fired per file so GitSync marks them dirty and pushes ciphertext.

async function transformVault(
  memory: Memory,
  predicate: (rel: string, raw: string) => boolean,
  fn: (raw: string) => string
): Promise<number> {
  let n = 0
  for (const rel of memory.allRelFiles()) {
    if (!rel.endsWith('.md')) continue
    const p = memory.resolve(rel)
    if (!existsSync(p)) continue
    let raw: string
    try { raw = readFileSync(p, 'utf8') } catch { continue }
    if (!predicate(rel, raw)) continue
    const next = fn(raw)
    if (next === raw) continue
    try {
      writeFileSync(p, next, 'utf8')
      memory.onWrite?.(rel)
      n++
    } catch { /* per-file best effort */ }
  }
  return n
}

export async function encryptAll(store: Store, memory: Memory): Promise<number> {
  const crypto = vaultCrypto(store)
  if (!crypto) throw new Error('encryption key not configured')
  return transformVault(
    memory,
    (rel, raw) => crypto.encryptsPath(rel) && !crypto.isBlob(raw),
    (raw) => crypto.encrypt(raw)
  )
}

export async function decryptAll(store: Store, memory: Memory): Promise<number> {
  const crypto = vaultCrypto(store)
  if (!crypto) throw new Error('encryption key not configured')
  return transformVault(
    memory,
    (_rel, raw) => crypto.isBlob(raw),
    (raw) => {
      try { return crypto.decrypt(raw) } catch { return raw }
    }
  )
}

export interface SecurityPatch {
  enabled?: boolean
  categories?: string[]
  passphrase?: string   // ≥8 chars — derives a NEW key (rotates ciphertext)
}

const CATEGORY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

export async function securityConfigure(
  store: Store,
  memory: Memory,
  patch: SecurityPatch
): Promise<SecurityStatus> {
  const cur = { ...(store.get().security ?? {}) }
  const next: typeof cur = { ...cur }

  if (patch.categories !== undefined) {
    if (!Array.isArray(patch.categories) || patch.categories.length > 64) throw new Error('invalid categories')
    next.categories = [...new Set(patch.categories.map(c => String(c).trim().toLowerCase()))]
    for (const c of next.categories) if (!CATEGORY_RE.test(c)) throw new Error(`invalid category: ${c}`)
  }
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled

  if (patch.passphrase !== undefined) {
    const pass = String(patch.passphrase)
    if (pass.length < 8 || pass.length > 256) throw new Error('passphrase must be 8–256 chars')
    // Rotating the key invalidates existing ciphertext — decrypt everything
    // with the old key first, swap, then re-encrypt if enabled.
    const hadKey = !!cur.sealedKey
    const wasEnabled = !!cur.enabled
    const cats = next.categories ?? cur.categories ?? []
    if (hadKey) {
      const old = vaultCrypto(store)
      if (old) {
        await transformVault(memory, (_r, raw) => old.isBlob(raw), (raw) => {
          try { return old.decrypt(raw) } catch { return raw }
        })
      }
    }
    const salt = randomBytes(16).toString('hex')
    next.salt = salt
    next.sealedKey = scryptSync(pass, salt, 32).toString('hex') // sealed on store.set
    // restore prior intent, then apply new patch on top
    next.enabled = patch.enabled ?? wasEnabled
    next.categories = cats
    if (next.enabled) {
      const fresh = vaultCryptoFor(next)
      if (fresh) {
        await transformVault(
          memory,
          (rel, raw) => fresh.encryptsPath(rel) && !fresh.isBlob(raw),
          (raw) => fresh.encrypt(raw)
        )
      }
    }
    store.set({ security: next })
  } else {
    store.set({ security: next })
  }
  return securityStatus(store, memory)
}

// ── AI advisor: turns scan evidence into concrete recommendations ──

export async function securityAiAlerts(
  store: Store,
  memory: Memory,
  localLlm: LocalLlm | null
): Promise<string> {
  const [status, scan] = await Promise.all([securityStatus(store, memory), securityScan(store, memory)])
  const ctx = [
    `Vault: ${status.totalMdFiles} markdown files, ${status.encryptedFiles} encrypted at rest.`,
    `Encryption: ${status.enabled ? 'ON' : 'OFF'}${status.configured ? '' : ' (no key set)'}. Categories: ${(status.categories ?? []).join(', ') || 'none'}.`,
    `Secret scan: ${scan.totalHits} hits across ${Object.keys(scan.byLabel).length} pattern types; ${scan.unencryptedHits} in plaintext files.`,
    `PII scan: ${scan.piiTotal} exposures (${Object.entries(scan.piiByLabel).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}).`,
    `Top patterns: ${Object.entries(scan.byLabel).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}.`,
    scan.hits.slice(0, 15).map(h => `- ${h.path}:${h.line} [${h.label}] ${h.encrypted ? '(encrypted)' : '(PLAINTEXT)'}`).join('\n')
  ].join('\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are the security advisor of a local-first "second brain" app. The user\'s markdown vault syncs to their private GitHub repo and is read by LLM agents. Analyze the evidence and give concise, prioritized recommendations IN THE USER\'S LANGUAGE. Focus on: secrets exposure, encryption gaps, sync/privacy risks, and concrete next actions. Never print secret values. Use markdown bullets, max ~250 words.'
    },
    { role: 'user', content: ctx }
  ]
  const res = await chat(store.get().ai, messages, [], localLlm?.endpoint)
  return res.text
}
