import path from 'node:path'
import { readJson, writeJsonAtomic } from './lib.mjs'
import { mintToken, verifyTokenHash } from './api-tokens.mjs'

const REL = 'ops/sync-tokens.json'

function storePath(vault) {
  return path.join(vault, REL)
}

function load(vault) {
  const data = readJson(storePath(vault), { tokens: [] })
  return Array.isArray(data.tokens) ? data.tokens : []
}

function save(vault, tokens) {
  writeJsonAtomic(storePath(vault), { tokens })
}

export function listSyncTokens(vault) {
  return load(vault).map((row) => ({
    id: row.id,
    label: row.label,
    scopes: row.scopes,
    userId: row.userId,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    lastUsedAt: row.lastUsedAt || null,
    revokedAt: row.revokedAt || null
  }))
}

export function createSyncToken(vault, { label, userId, createdBy, scopes }) {
  const minted = mintToken(label, scopes)
  const row = {
    id: minted.id,
    label: minted.label,
    hash: minted.hash,
    scopes: minted.scopes,
    userId,
    createdAt: minted.createdAt,
    createdBy,
    lastUsedAt: null,
    revokedAt: null
  }
  const tokens = load(vault)
  tokens.push(row)
  save(vault, tokens)
  return { ...row, secret: minted.secret }
}

export function revokeSyncToken(vault, id) {
  const tokens = load(vault)
  const idx = tokens.findIndex((t) => t.id === id)
  if (idx < 0) return false
  tokens[idx] = { ...tokens[idx], revokedAt: new Date().toISOString() }
  save(vault, tokens)
  return true
}

export function resolveSyncBearer(vault, secret) {
  if (!secret || secret.length < 16) return null
  const tokens = load(vault)
  for (let i = 0; i < tokens.length; i++) {
    const row = tokens[i]
    if (row.revokedAt) continue
    if (!verifyTokenHash(secret, row.hash)) continue
    tokens[i] = { ...row, lastUsedAt: new Date().toISOString() }
    save(vault, tokens)
    return { tokenId: row.id, userId: row.userId, scopes: row.scopes || [], label: row.label }
  }
  return null
}
