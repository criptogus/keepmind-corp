import { resolve, sep } from 'node:path'

// Containment guard: resolved path must stay inside `root`.
// Returns the absolute path or throws — fail closed, never silently clamp.
export function resolveInside(root: string, ...parts: string[]): string {
  const base = resolve(root)
  const p = resolve(base, ...parts)
  if (p !== base && !p.startsWith(base + sep)) {
    throw new Error(`path escapes root: ${parts.join('/')}`)
  }
  return p
}

// Structured-clone patches arrive over IPC as plain objects, but a
// compromised renderer could still smuggle own-property "__proto__" keys.
// Spread-merge turns those into inert own props, yet stripping them here
// keeps the on-disk config clean and the merge semantics obvious.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function stripForbiddenKeys<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (!FORBIDDEN_KEYS.has(k)) out[k] = v
  }
  return out as T
}

export function isPlainObject(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
