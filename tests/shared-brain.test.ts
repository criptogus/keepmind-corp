import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const state = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.path } }))
import { sharedBrainConfigured, sharedBrainRead, sharedMemoryList, sharedMemorySearch, sharedMemoryCapture, sharedMemoryCorrection } from '../src/main/shared-brain'
afterEach(() => { vi.unstubAllGlobals(); if (state.path) rmSync(state.path, { recursive: true, force: true }); state.path = '' })
it('requires an explicit shared vault, without selecting or changing a store', () => {
  state.path = mkdtempSync(join(tmpdir(), 'km-bridge-'))
  expect(sharedBrainConfigured()).toBe(false)
  mkdirSync(join(state.path, 'second-brain'))
  const file = join(state.path, 'second-brain/ui-bridge-connection.json')
  writeFileSync(file, JSON.stringify({ encrypted: true }))
  expect(sharedBrainConfigured()).toBe(false)
  writeFileSync(file, JSON.stringify({ sharedVault: '/fictional/vault' }))
  expect(sharedBrainConfigured()).toBe(true)
})
it('authenticates each native read with a session capability', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ token: 'temporary-test-capability' })).mockResolvedValueOnce(Response.json({ nodes: [], links: [] }))
  vi.stubGlobal('fetch', fetcher)
  expect(await sharedBrainRead('/graph')).toEqual({ nodes: [], links: [] })
  expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1:4175/api/keepmind/graph')
  expect(fetcher.mock.calls[1][1].headers['X-Keepmind-Session']).toBe('temporary-test-capability')
})
it('reports bridge failures instead of fabricating a graph', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(sharedBrainRead('/graph')).rejects.toThrow('indisponível')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('lists shared metadata without reading every body and searches full sources through MCP bridge', async () => {
  const body = '# Real source\n' + 'context '.repeat(3000)
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/session')) return Response.json({ token: 'test' })
    if (url.endsWith('/notes')) return Response.json([{ path: 'wiki/source.md', title: 'Source' }])
    if (url.endsWith('/search')) return Response.json({ text: 'wiki/source.md' })
    return Response.json({ body })
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await sharedMemoryList()).toEqual([{ path: 'wiki/source.md', title: 'Source', content: '' }])
  expect(fetcher).toHaveBeenCalledTimes(2)
  const result = await sharedMemorySearch('context')
  expect(result.hits[0].title).toBe('Real source'); expect(result.semantic).toBe(false)
  expect(await sharedBrainRead('/note?path=wiki%2Fsource.md')).toEqual({ body })
})
it('captures only a new shared note and keeps original corrections as explicit proposals', async () => {
  const writes: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    if (url.endsWith('/session')) return Response.json({ token: 'test' })
    if (init.method === 'POST') { const data = JSON.parse(init.body); writes.push(data); return Response.json(data) }
    return Response.json({ body: 'Original fact', etag: 'revision' })
  }))
  await sharedMemoryCapture('A real capture')
  const result = await sharedMemoryCorrection('Original fact', 'Corrected fact', 'wiki/original.md')
  expect(writes[0].path).toMatch(/^notes\/captures\/.*\.md$/); expect(writes[0].create).toBe(true)
  expect(writes[1].path).toMatch(/^notes\/change-proposals\/.*\.md$/); expect(writes[1].body).toContain('wiki/original.md')
  expect(result.proposed).toBe(true)
  await expect(sharedMemoryCorrection('Absent fact', 'Correction', 'wiki/original.md')).rejects.toThrow('CORRECTION_NEEDS_FACT')
  expect(writes).toHaveLength(2)
})
it('propagates shared memory failure without pretending an empty list or switching vaults', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('MCP offline')))
  await expect(sharedMemoryList()).rejects.toThrow('MCP offline')
  await expect(sharedMemoryCapture('Keep this draft')).rejects.toThrow('MCP offline')
})
