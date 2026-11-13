import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createDecipheriv, createCipheriv } from 'node:crypto'
import { corpCrm } from '../corp/crm-api.mjs'
import { listCorpCrmFiles, migrateCorpCrm, readCorpCrm } from '../corp/crm-storage.mjs'
import { CrmService } from '../tools/lib/crm.mjs'
import { encryptVault, decryptVault } from '../tools/lib/vault-crypto.mjs'

const faults = vi.hoisted(() => ({ renameTarget: '' }))
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, renameSync: (from: string, to: string) => {
    if (to === faults.renameTarget) throw Error('simulated interrupted replacement')
    return fs.renameSync(from, to)
  } }
})
const dirs: string[] = []
afterEach(() => { faults.renameTarget = ''; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const personal = (id: string) => `people/${id}/memory/crm/relationships.md`
const team = 'shared/crm/teams/alpha/crm/relationships.md'
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'km-crm-storage-')); dirs.push(dir)
  const vault = path.join(dir, 'vault'); mkdirSync(vault)
  const a = { id: 'alice', teamId: 'alpha', role: 'member' }
  const b = { id: 'bob', teamId: 'beta', role: 'member' }
  const org = { users: [a, b], teams: [{ id: 'alpha' }, { id: 'beta' }] }
  return { dir, vault, a, b, org, key: `${vault}.crm-key`, meta: path.join(vault, 'ops/crm-encryption.json') }
}
function legacy(vault: string, rel = personal('alice')) {
  let raw: string | null = null
  const s = new CrmService({ read: () => raw, write: (_p: string, text: string) => { raw = text }, scopePath: (p: string) => p, space: () => rel.startsWith('people') ? 'personal' : 'team', assertEvidencePath: () => {}, withLock: (_p: string, fn: () => unknown) => fn() })
  let x = s.dispatch('create_contact', { name: 'Sensitive sentinel 7482', email: 'private@example.com', expectedRevision: 0 })
  x = s.dispatch('record_interaction', { contactId: x.contacts[0].id, body: 'Confidential history', channel: 'note', direction: 'internal', expectedRevision: x.revision })
  x = s.dispatch('prepare_draft', { contactId: x.contacts[0].id, body: 'Private draft', expectedRevision: x.revision })
  raw = raw!.replace('class: internal', 'class: sensitive')
  const file = path.join(vault, rel); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, raw)
  return { raw, snapshot: x, file }
}

describe('Corp CRM encrypted persistence and migration', () => {
  it('checks without mutation, migrates atomically, and verifies idempotently', () => {
    const f = fixture(), old = legacy(f.vault)
    legacy(f.vault, team)
    const crm = corpCrm(f.vault, f.org, f.a)
    expect(() => crm.dispatch('snapshot')).toThrow('CRM_MIGRATION_REQUIRED')
    expect(migrateCorpCrm(f.vault)).toMatchObject({ examined: 2, pending: 2, migrated: 0, failed: 0 })
    expect(readFileSync(old.file, 'utf8')).toBe(old.raw)
    expect(existsSync(f.key)).toBe(false)
    expect(migrateCorpCrm(f.vault, { apply: true })).toMatchObject({ examined: 2, migrated: 2, failed: 0 })
    const sealed = readFileSync(old.file, 'utf8')
    expect(sealed.startsWith('KMS1\n')).toBe(true)
    expect(sealed).not.toContain('sentinel')
    expect(readCorpCrm(f.vault, personal('alice'))).toBe(old.raw)
    expect(crm.dispatch('snapshot')).toMatchObject({ contacts: old.snapshot.contacts, interactions: old.snapshot.interactions, drafts: old.snapshot.drafts, revision: old.snapshot.revision })
    expect(crm.externalModelAllowed()).toBe(false)
    expect(migrateCorpCrm(f.vault, { apply: true })).toMatchObject({ verified: 2, migrated: 0, failed: 0 })
    expect(readFileSync(old.file, 'utf8')).toBe(sealed)
    // No plaintext backup or scratch is introduced by migration.
    expect(readdirSync(path.dirname(old.file))).toEqual(['relationships.md'])
    expect(listCorpCrmFiles(f.vault)).toHaveLength(2)
  })
  it('keeps the original intact on interruption and resumes with the same persisted key', () => {
    const f = fixture(), old = legacy(f.vault)
    faults.renameTarget = old.file
    const failed = migrateCorpCrm(f.vault, { apply: true })
    expect(failed).toMatchObject({ failed: 1, migrated: 0 })
    expect(JSON.stringify(failed)).not.toContain('sentinel')
    expect(readFileSync(old.file, 'utf8')).toBe(old.raw)
    expect(readdirSync(path.dirname(old.file))).toEqual(['relationships.md'])
    const key = readFileSync(f.key)
    faults.renameTarget = ''
    expect(migrateCorpCrm(f.vault, { apply: true }).migrated).toBe(1)
    expect(readFileSync(f.key)).toEqual(key)
    expect(readCorpCrm(f.vault, personal('alice'))).toBe(old.raw)
  })
  it('preserves invalid legacy input, reports partial progress and resumes remaining records', () => {
    const f = fixture(), good = legacy(f.vault), bad = legacy(f.vault, team)
    writeFileSync(bad.file, 'malformed confidential input')
    expect(migrateCorpCrm(f.vault, { apply: true })).toMatchObject({ migrated: 1, failed: 1 })
    expect(readFileSync(bad.file, 'utf8')).toBe('malformed confidential input')
    expect(readCorpCrm(f.vault, personal('alice'))).toBe(good.raw)
    writeFileSync(bad.file, bad.raw)
    expect(migrateCorpCrm(f.vault, { apply: true })).toMatchObject({ verified: 1, migrated: 1, failed: 0 })
  })
  it('respects runtime locks and never races a concurrent writer during migration', () => {
    const f = fixture(), old = legacy(f.vault)
    mkdirSync(`${old.file}.lock`)
    expect(migrateCorpCrm(f.vault, { apply: true })).toMatchObject({ failed: 1, migrated: 0 })
    expect(readFileSync(old.file, 'utf8')).toBe(old.raw)
    expect(existsSync(f.key)).toBe(false)
    rmSync(`${old.file}.lock`, { recursive: true })
    expect(migrateCorpCrm(f.vault, { apply: true }).migrated).toBe(1)
  })
  it.each(['missing', 'invalid', 'wrong'] as const)('fails closed with a %s key and allows recovery with the original key', kind => {
    const f = fixture(), old = legacy(f.vault)
    migrateCorpCrm(f.vault, { apply: true })
    const key = readFileSync(f.key), ciphertext = readFileSync(old.file)
    if (kind === 'missing') rmSync(f.key)
    else writeFileSync(f.key, kind === 'wrong' ? '11'.repeat(32) : 'invalid')
    expect(() => corpCrm(f.vault, f.org, f.a).dispatch('snapshot')).toThrow(/CRM_KEY_/)
    expect(migrateCorpCrm(f.vault, { apply: true }).failed).toBe(1)
    expect(readFileSync(old.file)).toEqual(ciphertext)
    expect(existsSync(f.key)).toBe(kind !== 'missing')
    writeFileSync(f.key, key, { mode: 0o600 })
    expect(readCorpCrm(f.vault, personal('alice'))).toBe(old.raw)
  })
  it('rejects damaged metadata, symlink keys and ciphertext without initialization metadata', () => {
    const f = fixture(), old = legacy(f.vault)
    migrateCorpCrm(f.vault, { apply: true })
    const metadata = readFileSync(f.meta), key = readFileSync(f.key)
    writeFileSync(f.meta, '{}')
    expect(() => readCorpCrm(f.vault, personal('alice'))).toThrow('CRM_KEY_METADATA_INVALID')
    writeFileSync(f.meta, metadata)
    rmSync(f.key); const linked = path.join(f.dir, 'linked-key'); writeFileSync(linked, key); symlinkSync(linked, f.key)
    expect(() => readCorpCrm(f.vault, personal('alice'))).toThrow('CRM_STORAGE_INVALID')
    rmSync(f.key); writeFileSync(f.key, key, { mode: 0o600 }); rmSync(f.meta)
    expect(() => corpCrm(f.vault, f.org, f.b).dispatch('create_contact', { name: 'New', expectedRevision: 0 })).toThrow('CRM_KEY_METADATA_MISSING')
    expect(readFileSync(old.file, 'utf8').startsWith('KMS1\n')).toBe(true)
  })
  it('authenticates the full owner/team path and detects corruption and plaintext downgrade', () => {
    const f = fixture(); legacy(f.vault); legacy(f.vault, personal('bob')); legacy(f.vault, team)
    migrateCorpCrm(f.vault, { apply: true })
    const original = readFileSync(path.join(f.vault, personal('alice')), 'utf8')
    for (const rel of [personal('bob'), team]) {
      writeFileSync(path.join(f.vault, rel), original)
      expect(() => readCorpCrm(f.vault, rel)).toThrow('CRM_DATA_AUTHENTICATION_FAILED')
    }
    const raw = Buffer.from(original.slice(5), 'base64'); raw[raw.length - 1] ^= 1
    writeFileSync(path.join(f.vault, personal('alice')), 'KMS1\n' + raw.toString('base64'))
    expect(() => readCorpCrm(f.vault, personal('alice'))).toThrow('CRM_DATA_AUTHENTICATION_FAILED')
    legacy(f.vault)
    expect(() => readCorpCrm(f.vault, personal('alice'))).toThrow('CRM_MIGRATION_REQUIRED')
  })
  it('restores a moved vault only with its separately backed-up key, without including the key in the vault', () => {
    const f = fixture(), old = legacy(f.vault)
    migrateCorpCrm(f.vault, { apply: true })
    expect(path.relative(f.vault, f.key).startsWith('..')).toBe(true)
    const restored = path.join(f.dir, 'restored')
    renameSync(f.vault, restored)
    expect(() => readCorpCrm(restored, personal('alice'))).toThrow('CRM_KEY_UNAVAILABLE')
    renameSync(f.key, `${restored}.crm-key`)
    expect(readCorpCrm(restored, personal('alice'))).toBe(old.raw)
  })
  it('rejects symlink migration targets without touching files outside the vault', () => {
    const f = fixture(), old = legacy(f.vault)
    const outside = path.join(f.dir, 'outside'); writeFileSync(outside, old.raw)
    rmSync(old.file); symlinkSync(outside, old.file)
    expect(() => migrateCorpCrm(f.vault, { apply: true })).toThrow('EVIDENCE_PATH_DENIED')
    expect(readFileSync(outside, 'utf8')).toBe(old.raw)
    expect(existsSync(f.key)).toBe(false)
  })
  it('provides useful batch exit codes, rejects an empty vault and verifies a completed migration', () => {
    const f = fixture()
    const run = (...args: string[]) => spawnSync(process.execPath, ['corp/migrate-crm.mjs', '--vault', f.vault, ...args], { encoding: 'utf8' })
    expect(run('--check').status).toBe(2)
    legacy(f.vault)
    expect(run('--check').status).toBe(1)
    const migrated = run('--apply')
    expect(migrated.status).toBe(0)
    expect(JSON.parse(migrated.stdout)).toMatchObject({ examined: 1, migrated: 1, failed: 0 })
    const checked = run('--check')
    expect(checked.status).toBe(0)
    expect(JSON.parse(checked.stdout).verified).toBe(1)
  })
})

describe('shared native vault envelope compatibility', () => {
  it('preserves the existing AES-GCM format and authenticates optional path context', () => {
    const key = Buffer.alloc(32, 7), iv = Buffer.alloc(12, 8), text = 'Legacy vault content'
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    const legacyBlob = 'KMS1\n' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
    expect(decryptVault(legacyBlob, key)).toBe(text)
    const raw = Buffer.from(encryptVault(text, key).slice(5), 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); decipher.setAuthTag(raw.subarray(12, 28))
    expect(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString()).toBe(text)
    const bound = encryptVault(text, key, 'person/alice')
    expect(decryptVault(bound, key, 'person/alice')).toBe(text)
    expect(() => decryptVault(bound, key, 'person/bob')).toThrow('Vault authentication failed')
    expect(() => decryptVault(bound, key)).toThrow('Vault authentication failed')
  })
})
