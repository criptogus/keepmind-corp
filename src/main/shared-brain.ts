import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Only the explicitly selected shared vault uses the loopback bridge.
export function sharedBrainConfigured(): boolean {
  try { return !!JSON.parse(readFileSync(join(app.getPath('userData'), 'second-brain', 'ui-bridge-connection.json'), 'utf8')).sharedVault }
  catch { return false }
}
export async function sharedBrainRead(path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const base = 'http://127.0.0.1:4175/api/keepmind'
  const headers: Record<string, string> = { 'X-Keepmind-UI': '1' }
  const session = await fetch(base + '/session', { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) })
  if (!session.ok) throw new Error('Ponte KeepMind indisponível')
  headers['X-Keepmind-Session'] = (await session.json()).token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(base + path, { headers, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Falha ao consultar memória compartilhada')
  return data
}

// List metadata only; fetch the complete source on selection, never thousands of bodies.
export async function sharedMemoryList() {
  const notes = await sharedBrainRead('/notes')
  if (!Array.isArray(notes)) throw new Error('Índice de memória inválido')
  return notes.map(n => ({ path: n.path, title: n.title, content: '' }))
}
export async function sharedMemorySearch(query: string) {
  const result = await sharedBrainRead('/search', { query })
  if (typeof result.text !== 'string') throw new Error('Busca de memória inválida')
  const paths = [...new Set<string>(result.text.split('\n').map((p: string) => p.trim()).filter(Boolean))]
  const hits = await Promise.all(paths.map(async path => {
    const note = await sharedBrainRead('/note?path=' + encodeURIComponent(path))
    if (typeof note.body !== 'string') throw new Error('Fonte indisponível')
    return { path, title: note.body.match(/^#\s+(.+)$/m)?.[1] ?? path.split('/').at(-1), snippet: note.body.replace(/^---[\s\S]*?---\s*/, '').slice(0, 180) }
  }))
  return { hits, semantic: false, notice: 'Busca no mesmo second brain conectado ao Hoje.' }
}
export async function sharedMemoryCapture(text: string) {
  if (typeof text !== 'string' || text.trim().length < 3 || text.length > 100000) throw new Error('Nota inválida')
  return sharedBrainRead('/note', { path: 'notes/captures/' + randomUUID() + '.md', body: text.trim(), create: true })
}
export async function sharedMemoryCorrection(claim: string, correction: string, sourcePath?: string) {
  if (!sourcePath || typeof claim !== 'string' || typeof correction !== 'string' || claim.trim().length < 3 || correction.trim().length < 3) throw new Error('CORRECTION_NEEDS_SOURCE')
  const source = await sharedBrainRead('/note?path=' + encodeURIComponent(sourcePath))
  if (typeof source.body !== 'string' || !source.body.includes(claim)) throw new Error('CORRECTION_NEEDS_FACT')
  const saved = await sharedBrainRead('/note', { path: 'notes/change-proposals/' + randomUUID() + '.md', create: true,
    body: '# Correção proposta pelo proprietário\n\nEstado: proposta, não aplicada à fonte.\nFonte: ' + sourcePath + '\nRevisão: ' + source.etag + '\n\n## Trecho original\n' + claim + '\n\n## Correção solicitada\n' + correction })
  return { proposed: true, path: saved.path }
}
