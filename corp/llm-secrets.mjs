import path from 'node:path'
import { readJson, writeJsonAtomic, PROVIDERS } from './lib.mjs'
import { getOrgSecret } from './org-secrets.mjs'

const REL = 'ops/llm-secrets.json'
// 'local'/'ollama' need no key; cloud providers do.
const LLM_PROVIDERS = PROVIDERS.filter((p) => p !== 'local' && p !== 'ollama')

function file(vault) {
  return path.join(vault, REL)
}

function load(vault) {
  return readJson(file(vault), {})
}

function normalizeScope(scope) {
  const s = String(scope || '').trim()
  if (!s) return ''
  const m = /^(role|team|user):(.+)$/.exec(s)
  if (!m) return ''
  return `${m[1]}:${String(m[2]).trim().slice(0, 60)}`
}

/**
 * Scoped LLM keys: "<provider>" (org default), "<provider>:role:<r>",
 * "<provider>:team:<id>", "<provider>:user:<id>". Resolution order for a
 * caller: user > team > role > org > legacy org-secret.
 */
export function setLlmSecrets(vault, entries) {
  const data = load(vault)
  for (const e of entries || []) {
    const provider = String(e.provider || '').trim()
    if (!LLM_PROVIDERS.includes(provider)) continue
    const scope = normalizeScope(e.scope)
    const key = scope ? `${provider}:${scope}` : provider
    const value = String(e.value ?? '').trim()
    if (!value) delete data[key]
    else data[key] = value
  }
  writeJsonAtomic(file(vault), data)
  return llmSecretStatus(vault)
}

export function llmSecretStatus(vault) {
  const data = load(vault)
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && v) out[k] = { set: true, hint: `…${v.slice(-4)}` }
  }
  return out
}

export function getLlmSecret(vault, provider, user) {
  if (!LLM_PROVIDERS.includes(provider) || !user) return null
  const data = load(vault)
  const scopes = [
    `user:${user.id}`,
    user.teamId ? `team:${user.teamId}` : null,
    `role:${user.role}`,
    ''
  ].filter(Boolean)
  for (const scope of scopes) {
    const key = scope ? `${provider}:${scope}` : provider
    const v = data[key]
    if (typeof v === 'string' && v) return v
  }
  return getOrgSecret(vault, provider)
}
