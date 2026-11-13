export const VAULT_MAGIC: string
export function encryptVault(text: string, key: Uint8Array, context?: string): string
export function decryptVault(blob: string, key: Uint8Array, context?: string): string
