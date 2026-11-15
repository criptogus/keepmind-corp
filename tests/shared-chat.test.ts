import { expect, it, vi } from 'vitest'
import { sharedMemoryChat } from '../src/main/shared-chat'
const source = { path: 'notes/decision.md', body: '# Decision\nKeep the current encryption.\nDo not create another vault.' }
const reply = { answer: 'Preserve the encryption [1].', citations: [{ path: source.path, quote: 'Keep the current encryption.' }], insufficient: false }
const read = async (path: string) => path === '/search' ? { text: source.path } : source
it('loads full MCP sources, validates literal citations and keeps links/history without writes', async () => {
  const complete = vi.fn(async () => ({ text: JSON.stringify(reply) })), reader = vi.fn(read)
  const history = [{ role: 'user' as const, content: 'What was the decision?' }]
  const result = await sharedMemoryChat('And the encryption?', history, { read: reader, complete })
  expect(result.memories).toEqual([source.path]); expect(result.saved).toEqual([])
  expect(result.text).toContain('Keep the current encryption.')
  expect(JSON.stringify(complete.mock.calls)).toContain('Do not create another vault.')
  expect(JSON.stringify(complete.mock.calls)).toContain('What was the decision?')
  expect(reader.mock.calls.every(([path]) => path === '/search' || path.startsWith('/note?'))).toBe(true)
})
it('rejects fabricated paths, quotes, missing references and ungrounded answers before returning text', async () => {
  for (const invalid of [
    { ...reply, citations: [{ path: 'secret.md', quote: 'Keep the current encryption.' }] },
    { ...reply, citations: [{ path: source.path, quote: 'Invented evidence' }] },
    { ...reply, answer: 'Claim [2].' }, { ...reply, answer: 'Claim without reference.' },
    { ...reply, citations: [] }
  ]) await expect(sharedMemoryChat('question', [], { read, complete: async () => ({ text: JSON.stringify(invalid) }) })).rejects.toThrow()
})
it('reports absent evidence and bridge failure without calling the model or switching stores', async () => {
  const complete = vi.fn()
  const result = await sharedMemoryChat('question', [], { read: async () => ({ text: '' }), complete })
  expect(result.memories).toEqual([]); expect(result.text).toContain('Não encontrei fontes')
  await expect(sharedMemoryChat('question', [], { read: async () => { throw Error('MCP unavailable') }, complete })).rejects.toThrow('MCP unavailable')
  expect(complete).not.toHaveBeenCalled()
})
it('honors cancellation during retrieval and generation', async () => {
  const c = new AbortController(), complete = vi.fn()
  await expect(sharedMemoryChat('question', [], { read: async () => { c.abort(); return { text: source.path } }, complete }, c.signal)).rejects.toThrow()
  expect(complete).not.toHaveBeenCalled()
  const second = new AbortController()
  await expect(sharedMemoryChat('question', [], { read, complete: async () => { second.abort(); return { text: JSON.stringify(reply) } } }, second.signal)).rejects.toThrow()
})
it('does not truncate oversized sources and does not call the model without usable context', async () => {
  const complete = vi.fn()
  const result = await sharedMemoryChat('question', [], { read: async path => path === '/search' ? { text: source.path } : { body: 'x'.repeat(120001) }, complete })
  expect(result.text).toContain('excedem o limite'); expect(complete).not.toHaveBeenCalled()
})
it('uses an explicitly named matching source without sending unrelated search hits', async () => {
 const reader = vi.fn(async (path: string) => path === '/search' ? { text: 'notes/unrelated.md\n' + source.path } : source)
 const result = await sharedMemoryChat('Read ' + source.path, [], { read: reader, complete: async () => ({text: JSON.stringify(reply)}) })
 expect(result.memories).toEqual([source.path]); expect(reader).toHaveBeenCalledTimes(2)
 expect(reader.mock.calls[1][0]).toBe('/note?path=notes%2Fdecision.md')
})
