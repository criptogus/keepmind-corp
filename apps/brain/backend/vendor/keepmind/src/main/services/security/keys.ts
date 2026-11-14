import sodium from 'libsodium-wrappers-sumo'
import { createHmac, randomUUID } from 'node:crypto'
import { createCryptoHeader, deriveKey, type CryptoHeader } from '../sync-crypto'
export interface SecretStore { put(id: string, secret: string): void; get(id: string): string; remove(id: string): void }
export class InMemorySecretStore implements SecretStore {
  private entries = new Map<string, string>()
  put(id: string, secret: string) { this.entries.set(id, secret) }
  get(id: string) { const v = this.entries.get(id); if (v === undefined) throw new Error('Secret unavailable'); return v }
  remove(id: string) { this.entries.delete(id) }
}
export interface SafeStorage { isEncryptionAvailable(): boolean; getSelectedStorageBackend?(): string; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
export class KeychainSecretStore implements SecretStore {
  constructor(private storage: SafeStorage, private backing: { read(id: string): string | undefined; write(id: string, value: string): void; remove(id: string): void }) {}
  private check() { if (!this.storage.isEncryptionAvailable() || this.storage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('OS keychain unavailable') }
  put(id: string, value: string) { this.check(); this.backing.write(id, this.storage.encryptString(value).toString('base64')) }
  get(id: string) { this.check(); const v = this.backing.read(id); if (!v) throw new Error('Secret unavailable'); return this.storage.decryptString(Buffer.from(v, 'base64')) }
  remove(id: string) { this.check(); this.backing.remove(id) }
}
const prefix = 'KEEPMIND-SEALED:1\n'
export function seal(text: string, key: Uint8Array, context: string): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  return prefix + JSON.stringify({ nonce: sodium.to_base64(nonce), box: sodium.to_base64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(text, context, null, nonce, key)) })
}
export function unseal(text: string, key: Uint8Array, context: string): string {
  if (!text.startsWith(prefix)) throw new Error('Expected encrypted data')
  try { const b = JSON.parse(text.slice(prefix.length)); return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, sodium.from_base64(b.box), context, sodium.from_base64(b.nonce), key, 'text') }
  catch { throw new Error('Data authentication failed') }
}
export const isSealed = (text: string) => text.startsWith(prefix)
export interface KeyConfig { version: 1; id: string; header: CryptoHeader; passphraseWrap: string; recoveryWrap: string; spaces: Record<string, string> }
export class SpaceKeys {
  private locked = false
  private check() { if (this.locked) throw new Error('Keys locked') }
  private constructor(private master: Uint8Array, readonly config: KeyConfig, readonly secrets: SecretStore) {}
  static async setup(passphrase: string, secrets: SecretStore) {
    await sodium.ready
    const header = await createCryptoHeader(), wrapping = await deriveKey(passphrase, header)
    const master = sodium.randombytes_buf(32), recovery = sodium.randombytes_buf(32), id = randomUUID()
    try {
      secrets.put(`master:${id}`, sodium.to_base64(master))
      const config: KeyConfig = { version: 1, id, header, passphraseWrap: seal(sodium.to_base64(master), wrapping, id), recoveryWrap: seal(sodium.to_base64(master), recovery, id), spaces: {} }
      return { keys: new SpaceKeys(master, config, secrets), recoveryKey: sodium.to_base64(recovery) }
    } finally { wrapping.fill(0); recovery.fill(0) }
  }
  static async unlock(config: KeyConfig, secrets: SecretStore, credential?: { passphrase?: string; recoveryKey?: string }) {
    await sodium.ready
    if (config.version !== 1) throw new Error('Unsupported key version')
    let master: Uint8Array
    if (credential) {
      const recovery = credential.recoveryKey !== undefined
      const key = recovery ? sodium.from_base64(credential.recoveryKey!) : await deriveKey(credential.passphrase ?? '', config.header)
      try { master = sodium.from_base64(unseal(recovery ? config.recoveryWrap : config.passphraseWrap, key, config.id)) } finally { key.fill(0) }
      secrets.put(`master:${config.id}`, sodium.to_base64(master))
    } else master = sodium.from_base64(secrets.get(`master:${config.id}`))
    return new SpaceKeys(master, config, secrets)
  }
  createSpace(space: string) {
    this.check()
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(space)) throw new Error('Invalid space')
    if (!this.config.spaces[space]) { const key = sodium.randombytes_buf(32); try { this.config.spaces[space] = seal(sodium.to_base64(key), this.master, `space:${space}`) } finally { key.fill(0) } }
  }
  private key(space: string) { this.check(); const box = this.config.spaces[space]; if (!box) throw new Error('Space locked or missing'); return sodium.from_base64(unseal(box, this.master, `space:${space}`)) }
  encrypt(text: string, space: string, context: string) { const k = this.key(space); try { return seal(text, k, `${space}:${context}`) } finally { k.fill(0) } }
  decrypt(text: string, space: string, context: string) { const k = this.key(space); try { return unseal(text, k, `${space}:${context}`) } finally { k.fill(0) } }
  token(term: string, space: string) { const k = this.key(space); try { return createHmac('sha256', k).update('keyword:').update(term).digest('hex') } finally { k.fill(0) } }
  databaseKey() { this.check(); return createHmac('sha256', this.master).update('keepmind:sqlcipher:v1').digest('hex') }
  lock() { this.locked = true; this.master.fill(0) }
}
