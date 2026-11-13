import { afterEach, expect, it, vi } from 'vitest'
import { BrainRuntime } from '../src/main/services/brain/runtime'
import { addActive, factsAsOf, readFacts } from '../src/main/services/facts'

afterEach(() => vi.useRealTimers())
function fixture(raw: string) {
  const files: Record<string, string> = { 'long-term/facts.md': raw, 'ops/eval.md': '' }
  const writes: string[] = []
  const brain = Object.create(BrainRuntime.prototype) as BrainRuntime
  Object.assign(brain, { memory: { scopePath: (p: string) => p, read: (p: string) => files[p] ?? null, write: (p: string, value: string) => { writes.push(p); files[p] = value } }, note: vi.fn() })
  return { brain, files, writes }
}
it('only supersedes one complete active fact and preserves historical queries', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2025-01-10T12:00:00Z'))
  const first = addActive('', 'A entrega será em junho.', 'teste', 'user')
  vi.setSystemTime(new Date('2025-02-10T12:00:00Z'))
  const { brain, files, writes } = fixture(first.raw)
  expect(brain.correctFact('FONTE: A ENTREGA SERÁ   EM JUNHO.', 'A entrega será em julho.')).toContain('Correção gravada')
  const facts = readFacts(files['long-term/facts.md']).facts
  expect(facts.find(f => f.id === first.id)?.status).toBe('archived')
  expect(facts.find(f => f.status === 'active')?.supersedes).toBe(first.id)
  expect(factsAsOf(files['long-term/facts.md'], '2025-01-20').map(f => f.text)).toContain('A entrega será em junho.')
  expect(factsAsOf(files['long-term/facts.md'], '2025-02-11').map(f => f.text)).toContain('A entrega será em julho.')
  expect(writes).toContain('ops/eval.md')
})
it('rejects absent, partial, ambiguous and invalid corrections without any writes', () => {
  const one = addActive('', 'A data de entrega é junho de 2025.', 'teste', 'user')
  const two = addActive(one.raw, 'A data de entrega é junho', 'teste', 'user')
  const { brain, writes } = fixture(two.raw)
  expect(() => brain.correctFact('A data de entrega', 'agosto')).toThrow('CORRECTION_NEEDS_FACT')
  expect(() => brain.correctFact('A data de entrega é junho de 2025.', 'agosto')).toThrow('CORRECTION_AMBIGUOUS')
  expect(() => brain.correctFact('fato inexistente', 'agosto')).toThrow('CORRECTION_NEEDS_FACT')
  expect(() => brain.correctFact('A data de entrega é junho.', '  ')).toThrow('CORRECTION_INVALID')
  expect(writes).toEqual([])
})
