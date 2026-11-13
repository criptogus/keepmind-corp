// Shared AES-256-GCM envelope used by native vault storage and Corp CRM.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
export const VAULT_MAGIC = 'KMS1\n'
export function encryptVault(text, key, context = '') {
  if (key.length !== 32) throw Error('Invalid vault key')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  if (context) cipher.setAAD(Buffer.from(context, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return VAULT_MAGIC + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}
export function decryptVault(blob, key, context = '') {
  try {
    if (key.length !== 32 || !blob.startsWith(VAULT_MAGIC)) throw Error()
    const encoded = blob.slice(VAULT_MAGIC.length).trim()
    const raw = Buffer.from(encoded, 'base64')
    if (raw.length < 28 || raw.toString('base64') !== encoded) throw Error()
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    if (context) decipher.setAAD(Buffer.from(context, 'utf8'))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch { throw Error('Vault authentication failed') }
}
