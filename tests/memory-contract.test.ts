import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { formatFactSelection, selectFacts, labelMemorySource } from '../tools/lib/memory-contract.mjs'
import { RagService } from '../src/main/services/rag'
import { Memory } from '../src/main/services/brain'
import { BrainContext, limitFactContext } from '../src/main/services/brain/context'
import type { LocalLlm } from '../src/main/services/local-llm'
const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
const raw = `# Fatos
## Legado
legacy unverified
## Ativos
### f-new
- since: 2025-02-01
- source: conversation
- origin: user
- supersedes: f-old

The color is blue.
## Arquivo
### f-old
- since: 2025-01-01
- until: 2025-02-01
- source: note
- origin: chat
- superseded-by: f-new

The color is red.
## Propostas
### p-maybe
- since: 2025-03-01

The color is green.
`
it('selects dated versions and labels unverified and proposed material', () => {
  expect(selectFacts(raw).facts.map(f => f.id)).toEqual(['f-new'])
  expect(selectFacts(raw, { mode: 'asOf', asOf: '2025-01-31' }).facts.map(f => f.id)).toEqual(['f-old'])
  expect(selectFacts(raw, { mode: 'asOf', asOf: '2025-02-01' }).facts.map(f => f.id)).toEqual(['f-new'])
  expect(selectFacts(raw, { mode: 'asOf', asOf: '2025-02-01' }).legacy).toBe('')
  expect(formatFactSelection(raw)).toContain('legacy, undated and unverified')
  expect(formatFactSelection(raw)).not.toContain('color is red')
  expect(formatFactSelection(raw, { mode: 'history' })).toContain('proposal, unconfirmed')
  expect(formatFactSelection('A raw old statement')).toContain('unverified')
  expect(labelMemorySource('short-term/2025-01-01.md')).toContain('historical')
})
it('refreshes cached recall after a correction and respects space filters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-contract-')); dirs.push(dir)
  const memory = new Memory(join(dir, 'memory'), null, { allowPlaintext: true })
  memory.write('long-term/facts.md', raw.replace('The color is blue.', 'The color is red.').replace('The color is red.\n## Propostas', 'The color was orange.\n## Propostas'))
  writeFileSync(join(dir, 'memory/notes/secret.md'), '---\nspace: other\nclass: internal\n---\ncolor secretword')
  const model = { embedReady: false, isEmbedModelDownloaded: () => false } as unknown as LocalLlm
  const rag = new RagService(model, memory, dir)
  expect(await rag.search('color')).toContain('color is red')
  memory.write('long-term/facts.md', raw)
  const result = await rag.search('color')
  expect(result).toContain('color is blue')
  expect(result).not.toContain('color is red')
  expect(result).not.toContain('color is green')
  expect(result).not.toContain('secretword')
  expect(result).toContain('sha256:')
})

it('rejects invalid calendar dates and excludes future and expired active records', () => {
  const future = raw.replace('2025-02-01', '2999-02-01')
  expect(selectFacts(future).facts).toEqual([])
  expect(selectFacts(raw.replace('- since: 2025-02-01', '- since: 2025-02-30')).facts).toEqual([])
  expect(selectFacts(raw.replace('- since: 2025-02-01', '- since: 2025-02-01\n- until: 2025-03-01')).facts).toEqual([])
  expect(() => selectFacts(raw, { mode: 'asOf', asOf: '2025-02-29' })).toThrow()
  expect(formatFactSelection(future, { mode: 'history' })).toContain('not established as current')
})
it('keeps prompt labels intact and labels medium term and insights', () => {
  const text = formatFactSelection(raw) + '\n\n' + '[legacy, undated and unverified; not a confirmed current fact]\n' + 'x'.repeat(5000)
  const limited = limitFactContext(text, 300)
  expect(limited).toContain('[canonical current fact')
  expect(limited).not.toContain('x'.repeat(100))
  const ctx = Object.create(BrainContext.prototype) as any
  ctx.store = { get: () => ({ github: {}, ai: {} }) }
  ctx.memory = { scopePath: (p: string) => p, read: (p: string) => p === 'long-term/facts.md' ? raw : p.startsWith('medium-term/') || p.startsWith('insights/') ? 'old statement' : null, mediumTermFiles: () => ['week.md'], list: () => ['insight.md'] }
  const prompt = ctx.buildSystemContext({ persona: 'agent' })
  expect(prompt).toContain('canonical current facts take precedence'.replace('canonical', 'Canonical'))
  expect(prompt).toMatch(/medium-term\/week.md — historical source, unverified/)
  expect(prompt).toMatch(/insights\/insight.md — source material, unverified/)
})
it('native memory tool defaults to current and exposes history explicitly', async () => {
  const ctx = Object.create(BrainContext.prototype) as any
  ctx.memory = { scopePath: (p: string) => p, canonicalRelative: (p: string) => p, read: () => raw }
  const now = await ctx.execTool('get_memory', { path: 'long-term/facts.md' })
  expect(now).toContain('color is blue')
  expect(now).not.toContain('color is red')
  const history = await ctx.execTool('get_memory', { path: 'long-term/facts.md', mode: 'history' })
  expect(history).toContain('historical archived fact')
  expect(history).toContain('proposal, unconfirmed')
  expect(await ctx.execTool('get_memory', { path: 'long-term/facts.md', mode: 'asOf', asOf: '2025-02-30' })).toContain('valid YYYY-MM-DD')
})

it('retains fact status on each long indexed passage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-long-facts-')); dirs.push(dir)
  const memory = new Memory(join(dir, 'memory'), null, { allowPlaintext: true })
  const long = `${'filler content '.repeat(120)} currentuniqueword ${'extra detail '.repeat(90)}`
  const old = `${'legacy filler '.repeat(120)} legacyuniqueword ${'legacy detail '.repeat(90)}`
  memory.write('long-term/facts.md', `# Fatos\n## Legado\n${old}\n## Ativos\n### f-long\n- since: 2025-01-01\n\n${long}\n## Arquivo\n## Propostas\n`)
  const model = { embedReady: false, isEmbedModelDownloaded: () => false } as unknown as LocalLlm
  const rag = new RagService(model, memory, dir)
  const canonical = await rag.search('currentuniqueword')
  const legacy = await rag.search('legacyuniqueword')
  expect(canonical).toContain('canonical current fact'); expect(canonical).toContain('currentuniqueword')
  expect(legacy).toContain('legacy, undated and unverified'); expect(legacy).toContain('legacyuniqueword')
  const chunks = (await rag.database()).chunks()
  for (const chunk of chunks.filter(c => c.file === 'long-term/facts.md')) {
    expect(chunk.text.length).toBeLessThanOrEqual(900)
    expect(chunk.text).toMatch(/^\[(canonical current fact|legacy, undated and unverified)/)
  }
})
