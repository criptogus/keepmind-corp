import sodium from 'libsodium-wrappers-sumo'

export interface CryptoHeader { version: 1; kdf: 'argon2id13'; salt: string }
const PREFIX = 'KEEPMIND-ENCRYPTED:1\n'
export async function createCryptoHeader(): Promise<CryptoHeader> {
  await sodium.ready
  return { version: 1, kdf: 'argon2id13', salt: sodium.to_base64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)) }
}
export async function deriveKey(passphrase: string, header: CryptoHeader): Promise<Uint8Array> {
  await sodium.ready
  if (header.version !== 1 || header.kdf !== 'argon2id13') throw new Error('Unsupported KeepMind crypto header')
  const salt = sodium.from_base64(header.salt)
  if (salt.length !== sodium.crypto_pwhash_SALTBYTES || !passphrase) throw new Error('Invalid encryption salt or empty passphrase')
  return sodium.crypto_pwhash(sodium.crypto_secretbox_KEYBYTES, passphrase, salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE, sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE, sodium.crypto_pwhash_ALG_ARGON2ID13)
}
export async function encryptMemory(content: string, key: Uint8Array): Promise<string> {
  await sodium.ready
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  return PREFIX + JSON.stringify({ nonce: sodium.to_base64(nonce), box: sodium.to_base64(sodium.crypto_secretbox_easy(content, nonce, key)) })
}
export async function decryptMemory(content: string, key: Uint8Array): Promise<string> {
  await sodium.ready
  if (!content.startsWith(PREFIX)) throw new Error('Expected encrypted memory; refusing plaintext downgrade')
  try {
    const { nonce, box } = JSON.parse(content.slice(PREFIX.length))
    return sodium.crypto_secretbox_open_easy(sodium.from_base64(box), sodium.from_base64(nonce), key, 'text')
  } catch { throw new Error('Memory authentication failed: wrong passphrase or damaged ciphertext') }
}
export function isEncrypted(content: string): boolean { return content.startsWith('KEEPMIND-ENCRYPTED:') }
