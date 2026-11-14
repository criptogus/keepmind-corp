import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Only the explicitly selected shared vault uses the loopback bridge.
export function sharedBrainConfigured(): boolean {
  try { return !!JSON.parse(readFileSync(join(app.getPath('userData'), 'second-brain', 'ui-bridge-connection.json'), 'utf8')).sharedVault }
  catch { return false }
}
export async function sharedBrainRead(path: string): Promise<any> {
  const base = 'http://127.0.0.1:4175/api/keepmind'
  const headers: Record<string, string> = { 'X-Keepmind-UI': '1' }
  const session = await fetch(base + '/session', { headers, signal: AbortSignal.timeout(10000) })
  if (!session.ok) throw new Error('Ponte KeepMind indisponível')
  headers['X-Keepmind-Session'] = (await session.json()).token
  const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(60000) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Falha ao consultar memória compartilhada')
  return data
}
