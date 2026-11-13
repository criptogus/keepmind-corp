import { existsSync, readFileSync } from 'node:fs'

// Chromium truncates this file before writing the new debugging endpoint.
// A changed-but-empty file does not mean the relaunched app is ready.
export function readNewDebugPort(file, previous) {
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  if (text === previous || !/^\d+\r?\n\/devtools\/browser\/\S+/.test(text)) return null
  const port = Number(text.split('\n')[0])
  return port > 0 && port <= 65535 ? port : null
}
