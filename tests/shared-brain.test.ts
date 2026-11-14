import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const state = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.path } }))
import { sharedBrainConfigured, sharedBrainRead } from '../src/main/shared-brain'
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
