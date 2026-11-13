import { formatFactSelection, labelMemorySource, selectFacts } from '../../../tools/lib/memory-contract.mjs'
import { renderFacts } from './facts'
import { DerivedLearnings } from './derived-learnings'
import { policy } from './security/classification'
import { createHash } from 'node:crypto'
import { HybridSearch } from './search/hybrid'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { LocalLlm } from './local-llm'
import type { Memory } from './brain'
import type { LayaService } from './laya'

// ── Local RAG: semantic search over memory via llama.cpp embeddings ──
// mem0-style memory layer, but fully local: chunks of every memory file are
// embedded by the bundled embedding model and stored as vectors in a SQLite
// hybrid index. Chat queries embed the question and inject the top-k chunks into
// the system context — the brain "remembers" semantically, not just by recency.

interface Chunk {
  key: string        // hash of file+offset+text
  file: string
  offset: number
  text: string
  vec?: number[]
  space?: string
  class?: import('./security/classification').Classification
  stale?: boolean    // file declares valido_ate/expires in the past
}

interface Index {
  modelId?: string
  chunks: Chunk[]
}

const CHUNK_SIZE = 900
const CHUNK_OVERLAP = 150
const MAX_CHUNKS = 40000
const SEARCH_K = 6

// Order matters: on MAX_CHUNKS truncation the most durable/valuable
// sources survive — entities & long-term first, raw logs last.
const INDEX_DIRS = [
  'entities', 'long-term', 'notes', 'tasks', 'daily', 'skills', 'crm',
  'insights', 'summaries', 'sleep', 'review',
  'short-term', 'medium-term', 'agents', 'inbox', 'meetings'
]
const SKIP_FILES = new Set(['INDEX.md'])

export class RagService {
  private searchDb?: Promise<HybridSearch>
  private stateDir: string
  private index: Index = { chunks: [] }
  private embedding = false

  constructor(private localLlm: LocalLlm, memory: Memory, stateDir: string, private ownerIdentity?: { root: string; isOwner: () => Promise<boolean> }) {
    this.stateDir = stateDir
    this.memory = memory
    void this.database().catch(() => {})
  }

  private memory: Memory
  private laya: LayaService | null = null

  database(): Promise<HybridSearch> {
    if (existsSync(join(this.stateDir, 'security/memory-keys.json')) && !this.memory.keys) return Promise.reject(new Error('Index locked'))
    if (!this.searchDb) {
      this.searchDb = HybridSearch.open(join(this.stateDir, 'memory-search.sqlite'), join(this.stateDir, 'memory-embeddings.json'), () => this.memory.keys, () => this.memory.encryptAll).then(db => {
        try {
          this.index = { modelId: db.modelId, chunks: db.chunks({ space: this.memory.currentSpace, grants: this.memory.grants }) }
          return db
        } catch (error) { db.close(); throw error }
      })
      void this.searchDb.catch(() => { this.searchDb = undefined })
    }
    return this.searchDb
  }

  setLaya(l: LayaService) { this.laya = l }

  private async save() {
    const db = await this.database()
    db.replace(this.index.chunks.filter(c => c.space === this.memory.currentSpace || this.memory.grants.includes(c.space ?? 'personal')),  { space: this.memory.currentSpace, grants: this.memory.grants })
    db.modelId = this.index.modelId
    db.save()
  }

  get stats() {
    return {
      available: this.localLlm.isEmbedModelDownloaded(),
      running: this.localLlm.embedReady,
      modelId: this.localLlm.embedModelId ?? null,
      chunks: this.index.chunks.length,
      embedded: this.index.chunks.filter(c => c.vec).length
    }
  }

  // Rebuild the chunk list from memory files (cheap — no embeddings).
  // Vectors are kept per chunk-hash, so unchanged text never re-embeds.
  private async ensureChunks(): Promise<number> {
    await this.database()
    if (this.memory.keys) this.memory.protectExisting()
    const byKey = new Map(this.index.chunks.map(c => [c.key, c]))
    const next: Chunk[] = []
    let truncated = false
    const tier = (file: string) => file.replace(/^spaces\/[^/]+\//, '').split('/')[0]
    const files = this.memory.allRelFiles().filter(file => INDEX_DIRS.includes(tier(file)))
      .sort((a,b) => INDEX_DIRS.indexOf(tier(a)) - INDEX_DIRS.indexOf(tier(b)) || a.localeCompare(b))
    for (const file of files) {
      if (SKIP_FILES.has(file.split('/').pop()!)) continue
      const content = this.memory.read(file) ?? ''
      if (!content.trim()) continue
      const stale = isStale(content)
      // Never index archived facts or pending proposals as present-day recall.
      const chunks = /(?:^|\/)long-term\/facts\.md$/.test(file) ? factChunks(content) : chunkText(content)
      for (const chunk of chunks) {
        if (next.length >= MAX_CHUNKS) { truncated = true; break }
        const key = createHash('sha256').update(`${file}:${chunk.offset}:${chunk.text}`).digest('hex')
        const prev = byKey.get(key)
        next.push({ key, file, offset: chunk.offset, text: chunk.text, vec: prev?.vec, stale, ...policy(content) })
      }
      if (truncated) break
    }
    this.index.chunks = next
    await this.save()
    return next.length
  }

  // Embed any chunks missing vectors. Safe to call repeatedly.
  async embedPending(): Promise<number> {
    await this.database()
    if (this.embedding || !this.localLlm.embedReady) return 0
    if (this.index.modelId !== this.localLlm.embedModelId) {
      this.index.chunks.forEach(c => { c.vec = undefined })
      this.index.modelId = this.localLlm.embedModelId
      await this.save()
    }
    const pending = this.index.chunks.filter(c => !c.vec)
    if (!pending.length) return 0
    this.embedding = true
    let done = 0
    try {
      for (let i = 0; i < pending.length; i += 32) {
        const batch = pending.slice(i, i + 32)
        const vecs = await this.localLlm.embed(batch.map(c => c.text))
        if (!vecs) break
        batch.forEach((c, j) => { c.vec = vecs[j] })
        done += batch.length
        await this.save()
      }
    } finally {
      this.embedding = false
    }
    return done
  }

  // Full pipeline: refresh chunks then embed what's missing.
  reindex() { return this.memory.withScope(() => this.performReindex()) }
  private async performReindex(): Promise<{ chunks: number; embedded: number }> {
    const chunks = await this.ensureChunks()
    const embedded = await this.embedPending()
    return { chunks, embedded }
  }

  semanticReady(): boolean {
    return this.localLlm.embedReady
  }

  async semanticHits(query: string): Promise<{ path: string; title: string; snippet: string }[]> {
    const block = await this.search(query)
    if (!block) return []
    return [...block.matchAll(/### (\S+)[^\n]*\n([\s\S]*?)(?=\n### |$)/g)].map(m => ({
      path: m[1],
      title: m[1].split('/').pop() ?? m[1],
      snippet: m[2].replace(/\s+/g, ' ').trim().slice(0, 180)
    }))
  }

  // Semantic recall for a user message → formatted context block (or '').
  async search(query: string, space = this.memory.currentSpace, grants: string[] = this.memory.grants): Promise<string> {
    try {
      // Refresh before every query so corrections invalidate persisted chunks immediately.
      await this.ensureChunks()
      void this.embedPending().catch(() => {})
      const qv = this.localLlm.embedReady ? await this.localLlm.embed([query]).catch(() => null) : null
      const db = await this.database()
      const q = db.modelId === this.localLlm.embedModelId ? qv?.[0] : undefined
      const scored = db.search(query, q, SEARCH_K * 2, { space, grants })
      // Laya rerank (the vault's "Jev" slot): a calibrated yes/no relevance
      // verdict per candidate, blended with the hybrid score. ~33ms each,
      // only runs when the ONNX decision engine is installed.
      if (this.laya?.status().available && scored.length > 1) {
        const reranked = await Promise.all(scored.map(async x => {
          const p = await this.laya!.yesNo(
            `Query: ${query}\n\nCandidate memory:\n${x.c.text.slice(0, 700)}`,
            'Does this memory chunk contain information relevant to answering the query?'
          )
          return { ...x, laya: p }
        }))
        reranked.sort((a, b) => {
          const ra = (a.laya ?? 0.5) * 0.6 + a.s * 0.4
          const rb = (b.laya ?? 0.5) * 0.6 + b.s * 0.4
          return rb - ra
        })
        scored.length = 0
        scored.push(...reranked.slice(0, SEARCH_K))
      } else {
        scored.splice(SEARCH_K)
      }
      const good = scored.filter(x => x.s > 0)
      // Owner capability comes only from native composition, never query/scope arguments.
      let derived: string[] = []
      if (this.memory.keys && this.ownerIdentity && await this.ownerIdentity.isOwner()) {
        try {
          derived = new DerivedLearnings(this.ownerIdentity.root, this.stateDir, this.memory.keys, { owner: true, spaces: [space, ...grants] })
            .list(query, false).slice(0, SEARCH_K).map(r =>
              `### derived_learning:${r.id} (private)\nclass: internal\nspace: ${r.space}\n${r.body.slice(0, 900)}`)
        } catch { /* Registry/key failures never expose private results. */ }
      }
      return [...good.map(x =>
        `### ${x.c.file}${x.c.stale ? ' ⚠ stale' : ''} (score ${x.s.toFixed(2)})\nclass: ${x.c.class ?? 'internal'}\nspace: ${x.c.space ?? 'personal'}\nversion: sha256:${x.c.key}\nsource: ${/(?:^|\/)long-term\/facts\.md$/.test(x.c.file) ? 'selected fact document; see individual labels' : labelMemorySource(x.c.file)}\n${x.c.text.slice(0, 900)}`
      ), ...derived].join('\n\n')
    } catch { return '' }
  }

}

// A file is "stale" when its frontmatter declares an expiry date in the past
// (valido_ate / expires / review_after — inspired by vault note_validity).
const STALE_LINE = /^(valido_ate|expires|review_after|stale_after|valid_until)\s*:\s*['"]?(\d{4}-\d{2}-\d{2})/im
function isStale(content: string): boolean {
  if (!content.startsWith('---')) return false
  const end = content.indexOf('\n---', 3)
  const fm = end === -1 ? content.slice(0, 1500) : content.slice(0, end)
  const m = fm.match(STALE_LINE)
  return !!m && m[2] < new Date().toISOString().slice(0, 10)
}

function factChunks(raw: string): { offset: number; text: string }[] {
  const doc = selectFacts(raw)
  const entries = doc.facts.map(f => formatFactSelection(renderFacts({ facts: [f], legacy: '' })))
  if (doc.legacy) entries.push(formatFactSelection(renderFacts({ facts: [], legacy: doc.legacy })))
  const chunks: { offset: number; text: string }[] = []
  let base = 0
  for (const entry of entries) {
    const split = entry.indexOf('\n')
    if (split < 0) continue
    const fullLabel = entry.slice(0, split)
    const label = fullLabel.length > 400 ? `${fullLabel.slice(0, 397)}...]` : fullLabel
    const body = entry.slice(split + 1)
    const size = CHUNK_SIZE - label.length - 1
    const pieces = body.length <= size ? [{ offset: 0, text: body }] : chunkText(body, size, false)
    for (const piece of pieces) chunks.push({ offset: base + piece.offset, text: `${label}\n${piece.text}` })
    base += entry.length + 2
  }
  return chunks
}

function chunkText(text: string, size = CHUNK_SIZE, prefixHeadings = true): { offset: number; text: string }[] {
  const clean = text.replace(/\r\n/g, '\n')
  // heading index for section-aware context prefixes
  const headings = [...clean.matchAll(/^#{1,3}\s+(.+?)\s*$/gm)]
  const chunks: { offset: number; text: string }[] = []
  let i = 0
  while (i < clean.length && chunks.length < 400) {
    let end = Math.min(i + size, clean.length)
    // prefer breaking at paragraph/sentence boundary
    if (end < clean.length) {
      const window = clean.slice(i, end)
      const brk = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'))
      if (brk > size * 0.5) end = i + brk + 1
    }
    let body = clean.slice(i, end).trim()
    // prefix nearest preceding heading so chunks keep section context
    const h = [...headings].reverse().find(x => (x.index ?? 0) < i)
    if (prefixHeadings && h && body && !body.startsWith('#')) body = `§ ${h[1]}\n${body}`
    chunks.push({ offset: i, text: body })
    i = end - CHUNK_OVERLAP > i ? end - CHUNK_OVERLAP : end
    if (end >= clean.length) break
  }
  return chunks.filter(c => c.text.length > 40)
}
