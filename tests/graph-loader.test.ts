import { expect, it, vi } from 'vitest'
import { createGraphLoader } from '../src/renderer/src/components/graph-loader'
it('shares preloading with navigation instead of repeating the cold read', async () => {
  let finish!: (value: any) => void
  const read = vi.fn(() => new Promise(resolve => { finish = resolve }))
  const load = createGraphLoader(read)
  const prefetch = load(), navigation = load()
  expect(read).toHaveBeenCalledTimes(1)
  finish({ nodes: [], links: [] })
  expect(await navigation).toBe(await prefetch)
  await load()
  expect(read).toHaveBeenCalledTimes(1)
})
it('refreshes expired data and allows a retry after failure', async () => {
  let now = 0
  const read = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue({ nodes: [], links: [] })
  const load = createGraphLoader(read, () => now)
  await expect(load()).rejects.toThrow('offline')
  await load()
  now = 60001
  await load()
  expect(read).toHaveBeenCalledTimes(3)
})
it('does not share cached private data between session loaders', async () => {
  const a = createGraphLoader(async () => ({ nodes: ['a'] }))
  const b = createGraphLoader(async () => ({ nodes: ['b'] }))
  expect(await a()).toEqual({ nodes: ['a'] })
  expect(await b()).toEqual({ nodes: ['b'] })
})
