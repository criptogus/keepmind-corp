// Managed CRM aggregates only. Legacy imports and other memory sources are not rewritten.
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { encryptVault, decryptVault, VAULT_MAGIC } from '../tools/lib/vault-crypto.mjs'
import { assertNoSymlinkPath, withProjectLock } from '../tools/lib/continuity.mjs'
import { CrmService } from '../tools/lib/crm.mjs'

const META = 'ops/crm-encryption.json'
const MANAGED = /^(?:people\/[a-z0-9][a-z0-9-]{0,40}\/memory|shared\/crm\/teams\/[a-z0-9][a-z0-9-]{0,40})\/crm\/relationships\.md$/
const MAX_BYTES = 8 * 1024 * 1024
const fail = code => { throw Error(code) }
export const isCorpCrmFile = rel => MANAGED.test(rel)
function rootOf(vault) {
  if (!lstatSync(vault).isDirectory() || lstatSync(vault).isSymbolicLink()) fail('CRM_STORAGE_PATH_DENIED')
  return realpathSync(vault)
}
function checked(root, rel) { assertNoSymlinkPath(root, rel); return path.join(root, rel) }
function readBounded(file, max = MAX_BYTES) {
  const info = lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > max) fail('CRM_STORAGE_INVALID')
  return readFileSync(file, 'utf8')
}
function syncDirectory(dir) {
  // Windows does not expose POSIX directory fsync. File fsync is still required.
  if (process.platform === 'win32') return
  const fd = openSync(dir, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
function atomicWrite(file, text, verify) {
  const tmp = `${file}.${randomBytes(12).toString('hex')}.tmp`
  let fd
  try {
    fd = openSync(tmp, 'wx', 0o600)
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    verify?.(readBounded(tmp))
    renameSync(tmp, file)
    syncDirectory(path.dirname(file))
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(tmp) } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
}
export function listCorpCrmFiles(vault) {
  const root = rootOf(vault), files = []
  for (const [parent, suffix] of [['people', 'memory/crm/relationships.md'], ['shared/crm/teams', 'crm/relationships.md']]) {
    const dir = checked(root, parent)
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(entry.name)) continue
      const rel = `${parent}/${entry.name}/${suffix}`
      const file = checked(root, rel)
      if (existsSync(file)) files.push(rel)
    }
  }
  return files.sort()
}
function loadKey(vault, create) {
  const root = rootOf(vault), metaFile = checked(root, META), keyFile = `${root}.crm-key`
  const readKey = () => {
    if (!existsSync(keyFile)) fail('CRM_KEY_UNAVAILABLE')
    const text = readBounded(keyFile, 64)
    if (!/^[a-f0-9]{64}$/.test(text)) fail('CRM_KEY_INVALID')
    if (process.platform !== 'win32' && (lstatSync(keyFile).mode & 0o077)) fail('CRM_KEY_PERMISSIONS')
    return Buffer.from(text, 'hex')
  }
  const existing = () => {
    let meta
    try { meta = JSON.parse(readBounded(metaFile, 4096)) } catch { fail('CRM_KEY_METADATA_INVALID') }
    if (meta?.version !== 1 || !/^[a-f0-9]{32}$/.test(meta.namespace) || typeof meta.check !== 'string') fail('CRM_KEY_METADATA_INVALID')
    const key = readKey()
    try {
      if (decryptVault(meta.check, key, `corp-crm:key:${meta.namespace}`) !== 'keepmind-corp-crm') fail('CRM_KEY_INVALID')
      return { key, namespace: meta.namespace }
    } catch { key.fill(0); fail('CRM_KEY_INVALID') }
  }
  if (existsSync(metaFile)) return existing()
  if (!create) fail('CRM_KEY_UNAVAILABLE')
  mkdirSync(checked(root, 'ops'), { recursive: true, mode: 0o700 })
  checked(root, META); checked(root, `${META}.lock`)
  return withProjectLock(metaFile, () => {
    if (existsSync(metaFile)) return existing()
    // Never mint a replacement identity for an already encrypted vault.
    for (const rel of listCorpCrmFiles(root)) if (readBounded(checked(root, rel)).startsWith(VAULT_MAGIC)) fail('CRM_KEY_METADATA_MISSING')
    let key
    if (existsSync(keyFile)) key = readKey() // Resume initialization interrupted before metadata publication.
    else {
      key = randomBytes(32)
      let fd
      try { fd = openSync(keyFile, 'wx', 0o600); writeFileSync(fd, key.toString('hex')); fsyncSync(fd) }
      catch (e) { key.fill(0); throw e }
      finally { if (fd !== undefined) closeSync(fd) }
      syncDirectory(path.dirname(keyFile))
    }
    const namespace = randomBytes(16).toString('hex')
    try {
      const meta = { version: 1, namespace, check: encryptVault('keepmind-corp-crm', key, `corp-crm:key:${namespace}`) }
      atomicWrite(metaFile, JSON.stringify(meta))
      return { key, namespace }
    } catch (e) { key.fill(0); throw e }
  })
}
function context(namespace, rel) { return `corp-crm:record:v1:${namespace}:${rel}` }
function validateDocument(text, rel) {
  const board = rel.startsWith('people/') ? 'personal' : 'team'
  // Reuse the domain parser, including schema, references, classification and size limits.
  const service = new CrmService({ read: () => text, scopePath: () => rel, space: () => board, assertEvidencePath: () => {} })
  service.dispatch('snapshot')
}
export function readCorpCrm(vault, rel) {
  if (!isCorpCrmFile(rel)) fail('CRM_STORAGE_PATH_DENIED')
  const root = rootOf(vault), file = checked(root, rel)
  if (!existsSync(file)) return null
  const raw = readBounded(file)
  if (!raw.startsWith(VAULT_MAGIC)) fail('CRM_MIGRATION_REQUIRED')
  const { key, namespace } = loadKey(root, false)
  try { return decryptVault(raw, key, context(namespace, rel)) }
  catch { fail('CRM_DATA_AUTHENTICATION_FAILED') }
  finally { key.fill(0) }
}
export function writeCorpCrm(vault, rel, text) {
  if (!isCorpCrmFile(rel)) fail('CRM_STORAGE_PATH_DENIED')
  validateDocument(text, rel)
  const root = rootOf(vault), file = checked(root, rel)
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  checked(root, rel)
  const { key, namespace } = loadKey(root, true)
  try {
    const aad = context(namespace, rel), encrypted = encryptVault(text, key, aad)
    atomicWrite(file, encrypted, persisted => {
      if (decryptVault(persisted, key, aad) !== text) fail('CRM_WRITE_VERIFICATION_FAILED')
    })
  } finally { key.fill(0) }
}
export function migrateCorpCrm(vault, { apply = false } = {}) {
  const root = rootOf(vault), files = listCorpCrmFiles(root)
  const report = { examined: files.length, migrated: 0, verified: 0, pending: 0, failed: 0, errors: [] }
  for (const rel of files) {
    try {
      const file = checked(root, rel)
      checked(root, `${rel}.lock`)
      withProjectLock(file, () => {
        const raw = readBounded(file)
        if (raw.startsWith(VAULT_MAGIC)) { validateDocument(readCorpCrm(root, rel), rel); report.verified++; return }
        validateDocument(raw, rel)
        if (!apply) { report.pending++; return }
        // The same per-record lock as runtime mutation covers validation and replacement.
        writeCorpCrm(root, rel, raw)
        report.migrated++
      })
    } catch (e) {
      report.failed++
      // No source content or arbitrary filesystem errors in the report.
      report.errors.push({ resource: createHash('sha256').update(rel).digest('hex'), code: /^(?:CRM_|CORRUPT_CRM|PROJECT_LOCKED|EVIDENCE_PATH_DENIED)/.test(e.message) ? e.message : 'CRM_MIGRATION_FAILED' })
    }
  }
  return report
}
