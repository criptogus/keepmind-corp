import { afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const electron = vi.hoisted(() => ({ directory: '', available: true, fail: false, backend: 'gnome_libsecret' }))
vi.mock('electron', () => ({
  app: { getPath: () => electron.directory },
  safeStorage: {
    isEncryptionAvailable: () => electron.available,
    getSelectedStorageBackend: () => electron.backend,
    encryptString: (value: string) => { if (electron.fail) throw new Error('keychain failed'); return Buffer.from('sealed-' + value) },
    decryptString: (value: Buffer) => value.toString().slice(7)
  }
}))
import { Store } from '../src/main/store'
afterEach(() => { rmSync(electron.directory, { recursive: true, force: true }); electron.available = true; electron.fail = false; electron.backend = 'gnome_libsecret' })
it.each(['unavailable', 'failure', 'basic_text'])('seals via enc2 and reloads when OS storage is %s', reason => {
  electron.directory = mkdtempSync(join(tmpdir(), 'km-store-'))
  const store = new Store(); store.set({ onboardingDone: true })
  if (reason === 'unavailable') electron.available = false
  if (reason === 'failure') electron.fail = true
  if (reason === 'basic_text') electron.backend = 'basic_text'
  store.updateGithub({ accessToken: 'secret-token' })
  const persisted = readFileSync(join(electron.directory, 'second-brain/config.json'), 'utf8')
  expect(JSON.parse(persisted).github.accessToken).toMatch(/^enc2:/)
  expect(persisted).not.toContain('secret-token')
  expect(new Store().get().github.accessToken).toBe('secret-token')
})
it('fails closed when keyfile creation and OS storage are unavailable', () => {
  electron.directory = mkdtempSync(join(tmpdir(), 'km-store-'))
  const store = new Store()
  // Occupy the keyfile path before the first save; works even when running as root.
  mkdirSync(join(electron.directory, 'second-brain/.secret-key'))
  store.set({ onboardingDone: true })
  const path = join(electron.directory, 'second-brain/config.json')
  const before = readFileSync(path, 'utf8')
  electron.available = false
  expect(() => store.updateGithub({ accessToken: 'secret-token' })).toThrow(/storage/i)
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(store.get().github.accessToken).toBeUndefined()
})
it('seals secrets and reloads through OS storage', () => {
  electron.directory = mkdtempSync(join(tmpdir(), 'km-store-'))
  const store = new Store(); store.updateGithub({ accessToken: 'private-token' })
  const persisted = readFileSync(join(electron.directory, 'second-brain/config.json'), 'utf8')
  expect(persisted).not.toContain('private-token')
  expect(new Store().get().github.accessToken).toBe('private-token')
})

it('drops legacy Pro data when loading and re-saving config', () => {
  electron.directory = mkdtempSync(join(tmpdir(), 'km-store-'))
  const dir = join(electron.directory, 'second-brain')
  mkdirSync(dir)
  const path = join(dir, 'config.json')
  writeFileSync(path, JSON.stringify({
    onboardingDone: true,
    github: { repoName: 'my-memory' },
    pro: { active: true, key: 'x', paymentUrl: 'y' }
  }))

  const store = new Store()
  expect(store.get()).not.toHaveProperty('pro')
  expect(store.get().onboardingDone).toBe(true)
  expect(store.get().github.repoName).toBe('my-memory')
  store.set({ background: false })
  expect(JSON.parse(readFileSync(path, 'utf8'))).not.toHaveProperty('pro')
  expect(new Store().get()).not.toHaveProperty('pro')
})
