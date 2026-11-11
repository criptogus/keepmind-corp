import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { readJson, writeJsonAtomic } from './lib.mjs'

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'grok', 'oidc', 'github', 'github_readonly']

function secretsPath(vault) {
  return path.join(vault, 'ops', 'org-secrets.json')
}

export function orgSecretStatus(vault) {
  const data = readJson(secretsPath(vault), {})
  return {
    providers: Object.fromEntries(PROVIDERS.map(id => [id, Boolean(data[id])]))
  }
}

export function getOrgSecret(vault, provider) {
  if (!PROVIDERS.includes(provider)) return null
  const data = readJson(secretsPath(vault), {})
  const value = data[provider]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function setOrgSecrets(vault, patch) {
  const file = secretsPath(vault)
  mkdirSync(path.dirname(file), { recursive: true })
  const data = readJson(file, {})
  for (const [key, raw] of Object.entries(patch || {})) {
    if (!PROVIDERS.includes(key)) continue
    const value = String(raw || '').trim()
    if (!value) delete data[key]
    else data[key] = value
  }
  writeJsonAtomic(file, data)
  return orgSecretStatus(vault)
}
