import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, realpathSync, lstatSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { join, dirname, sep, resolve, parse } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { resolveInside } from '../safe-path'
import type { SpaceKeys } from './security/keys'

const SPACE = 'general-knowledge'
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const words = (s: string) => s.toLowerCase().match(/[\p{L}]{3,}/gu) ?? []
interface Provenance { path: string; space: string; version: string }
interface Learning {
  id: string; body: string; purpose: string; abstraction: 'principle'; applicability: string
  status: 'pending' | 'active' | 'suspended'; approved?: { digest: string; at: string }
  sourceChanged: boolean; sourceWrong: boolean; sourceDeleted: boolean
  provenance: { space: string; box: string }
}
export interface LearningAuthority { owner: boolean; spaces: string[]; approval?: boolean }
/** Local owner service. No networking, models, exports, publication or shared audience. */
export class DerivedLearnings {
  private file: string
  constructor(private root: string, state: string, private keys: SpaceKeys, private authority: LearningAuthority, private persistKeys?: () => void) {
    this.file = resolveInside(state, 'derived-learnings.box')
    this.authority = { ...authority, spaces: [...authority.spaces] }
  }
  private noLinks(path: string) {
    const absolute = resolve(path)
    let current = parse(absolute).root
    for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
      current = join(current, part)
      try { if (lstatSync(current).isSymbolicLink()) throw new Error('Learning unavailable') }
      catch (error: any) { if (error.code !== 'ENOENT') throw error }
    }
  }
  private transaction<T>(action: () => T): T {
    this.access()
    this.noLinks(dirname(this.file))
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const lock = this.file + '.lock'
    let fd: number
    try { fd = openSync(lock, 'wx', 0o600) } catch { throw new Error('Learning unavailable') }
    try { this.noLinks(this.file); return action() }
    finally { closeSync(fd); unlinkSync(lock) }
  }
  private access() {
    if (!this.authority.owner || !this.authority.spaces.length || !this.authority.spaces.every(s => Object.hasOwn(this.keys.config.spaces, s))) throw new Error('Learning unavailable')
  }
  private load(): Learning[] {
    this.access()
    this.noLinks(this.file)
    if (!existsSync(this.file)) return []
    return JSON.parse(this.keys.decrypt(readFileSync(this.file, 'utf8'), SPACE, 'derived-registry:v1'))
  }
  private save(rows: Learning[]) {
    if (!Object.hasOwn(this.keys.config.spaces, SPACE)) {
      this.keys.createSpace(SPACE)
      this.persistKeys?.()
    }
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = this.file + '.' + randomUUID() + '.tmp'
    try {
      writeFileSync(temporary, this.keys.encrypt(JSON.stringify(rows), SPACE, 'derived-registry:v1'), { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.file)
    } finally { if (existsSync(temporary)) unlinkSync(temporary) }
  }
  private evidence(path: string, expectedSpace?: string, requireAuthority = false): { text: string; space: string } {
    // Check lexical and real containment before reading evidence.
    const file = resolveInside(this.root, path)
    this.noLinks(file)
    if (!realpathSync(file).startsWith(realpathSync(this.root) + sep)) throw new Error('Evidence unavailable')
    const raw = readFileSync(file, 'utf8')
    if (!raw.startsWith('KEEPMIND-ITEM:1\n')) throw new Error('Evidence unavailable')
    const e = JSON.parse(raw.slice('KEEPMIND-ITEM:1\n'.length))
    if (requireAuthority && !this.authority.spaces.includes(e.space)) throw new Error('Evidence unavailable')
    if (expectedSpace && e.space !== expectedSpace) throw new Error('Evidence unavailable')
    const text = this.keys.decrypt(e.box, e.space, path)
    if (!text.split('\n').includes(`space: ${e.space}`)) throw new Error('Evidence unavailable')
    return { text, space: e.space }
  }
  private provenance(row: Learning): Provenance {
    return JSON.parse(this.keys.decrypt(row.provenance.box, row.provenance.space, `provenance:${row.id}`))
  }
  private lifecycle(row: Learning) {
    try {
      const p = this.provenance(row), e = this.evidence(p.path, p.space)
      row.sourceChanged = digest(e.text) !== p.version
    } catch { row.sourceDeleted = true }
    if (row.sourceDeleted || row.sourceWrong) row.status = 'suspended'
  }
  private view(row: Learning) {
    // Explicit allowlist: never return source flags, lineage, evidence or identifiers.
    return { id: row.id, type: 'derived_learning', space: SPACE, private: true, body: row.body, purpose: row.purpose, abstraction: row.abstraction, applicability: row.applicability, status: row.status }
  }
  suggest(path: string, body: string, purpose: string, applicability: string) { return this.transaction(() => this.suggestLocked(path, body, purpose, applicability)) }
  promote(id: string, approvalDigest: string) { return this.transaction(() => this.promoteLocked(id, approvalDigest)) }
  list(query?: string, includeInactive = false) { return this.transaction(() => this.listLocked(query, includeInactive)) }
  markSourceWrong(id: string) { return this.transaction(() => this.markSourceWrongLocked(id)) }
  private suggestLocked(path: string, body: string, purpose: string, applicability: string) {
    this.access()
    body = body.trim() || 'Record competing explanations before choosing an intervention, then revisit assumptions after observing results.'
    if (!body.trim() || !purpose.trim() || !applicability.trim() || [body, purpose, applicability].some(text => text.length > 4000)) throw new Error('Draft fields required')
    let e: { text: string; space: string }
    try { e = this.evidence(path, undefined, true) } catch { throw new Error('Learning unavailable') }
    if (!this.authority.spaces.includes(e.space) || e.space === SPACE) throw new Error('Learning unavailable')
    const rows = this.load(), id = randomUUID()
    const row: Learning = { id, body, purpose, applicability, abstraction: 'principle', status: 'pending', sourceChanged: false, sourceWrong: false, sourceDeleted: false,
      provenance: { space: e.space, box: this.keys.encrypt(JSON.stringify({ path, space: e.space, version: digest(e.text) }), e.space, `provenance:${id}`) } }
    if (![body, purpose, applicability].every(text => this.safeText(row, text))) throw new Error('Learning unavailable')
    rows.push(row); this.save(rows)
    return { ...this.view(row), approvalDigest: this.approvalDigest(row) }
  }
  private approvalDigest(row: Learning) { return digest(JSON.stringify([row.id, row.body, row.purpose, row.applicability, row.provenance.box])) }
  private promoteLocked(id: string, approvalDigest: string) {
    if (this.authority.approval !== true) throw new Error('Explicit local owner approval required')
    const rows = this.load(), row = rows.find(r => r.id === id)
    if (!row || !this.authority.spaces.includes(row.provenance.space)) throw new Error('Learning unavailable')
    this.lifecycle(row)
    if (row.status !== 'pending' || row.sourceChanged || row.sourceWrong || row.sourceDeleted || approvalDigest !== this.approvalDigest(row)) throw new Error('Exact pending revision approval required')
    if (![row.body, row.purpose, row.applicability].every(text => this.safeText(row, text))) throw new Error('Learning unavailable')
    row.approved = { digest: approvalDigest, at: new Date().toISOString() }; row.status = 'active'; this.save(rows)
    return this.view(row)
  }
  private listLocked(query?: string, includeInactive = false) {
    const rows = this.load()
    for (const row of rows) {
      if (row.status === 'active' || this.authority.spaces.includes(row.provenance.space)) this.lifecycle(row)
    }
    // Lifecycle evaluated at every retrieval, including deletion while client offline.
    if (rows.length) this.save(rows)
    return rows.filter(r => ((r.status === 'active' && r.approved?.digest === this.approvalDigest(r) && [r.body, r.purpose, r.applicability].every(text => this.safeText(r, text))) || (includeInactive && this.authority.spaces.includes(r.provenance.space) && [r.body, r.purpose, r.applicability].every(text => this.safeText(r, text)))) && (!query || r.body.toLowerCase().includes(query.toLowerCase()))).map(r => this.view(r))
  }
  sourceDetails(id: string) { return this.transaction(() => this.sourceDetailsLocked(id)) }
  private sourceDetailsLocked(id: string) {
    const rows = this.load()
    const row = rows.find(r => r.id === id)
    if (!row || !this.authority.spaces.includes(row.provenance.space)) throw new Error('Learning unavailable')
    try { this.lifecycle(row); this.save(rows); return { ...this.provenance(row), sourceChanged: row.sourceChanged, sourceWrong: row.sourceWrong, sourceDeleted: row.sourceDeleted } }
    catch { throw new Error('Learning unavailable') }
  }
  private markSourceWrongLocked(id: string) {
    const rows = this.load(), row = rows.find(r => r.id === id)
    if (!row || !this.authority.spaces.includes(row.provenance.space)) throw new Error('Learning unavailable')
    const source = this.provenance(row)
    for (const linked of rows) {
      if (linked.provenance.space !== source.space) continue
      const p = this.provenance(linked)
      if (p.path === source.path) { linked.sourceWrong = true; linked.status = 'suspended' }
    }
    this.save(rows)
    return { id, status: 'suspended' }
  }
  checkPublic(id: string, text: string) { return this.transaction(() => this.checkPublicLocked(id, text)) }
  private checkPublicLocked(id: string, text: string) {
    const blocked = { result: 'review_required', humanReviewRequired: true, publicationAuthorized: false } as const
    const rows = this.load()
    const row = rows.find(r => r.id === id)
    // No existence, authority, detector terms or evidence details in checker output.
    if (!row || !this.authority.spaces.includes(row.provenance.space) || !text.trim()) return blocked
    try {
      this.lifecycle(row)
      this.save(rows)
      if (row.status !== 'active' || row.approved?.digest !== this.approvalDigest(row)) return blocked
      return this.safeText(row, text) ? { result: 'no_automatic_risk_detected', humanReviewRequired: false, publicationAuthorized: false } : blocked
    } catch { return blocked }
  }
  private safeText(row: Learning, text: string): boolean {
    try {
      const p = this.provenance(row)
      this.evidence(p.path, p.space)
      const vocabulary = new Set<string>(words(p.path + ' ' + p.space))
      const walk = (dir: string, prefix = '') => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isSymbolicLink()) throw new Error('Evidence unavailable')
          if (entry.isDirectory()) walk(join(dir, entry.name), rel)
          else if (entry.name.endsWith('.md')) {
            const raw = readFileSync(resolveInside(this.root, rel), 'utf8')
            if (!raw.startsWith('KEEPMIND-ITEM:1\n')) throw new Error('Evidence unavailable')
            const envelope = JSON.parse(raw.slice('KEEPMIND-ITEM:1\n'.length))
            if (envelope.space === p.space) for (const w of words(this.evidence(rel, p.space).text)) vocabulary.add(w)
          }
        }
      }
      walk(this.root)
      // Conservative deterministic assistance, not an anonymization guarantee.
      const risk = /\d|https?:|@|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/iu.test(text)
        || (/^\p{Lu}/u.test(text) && !/^(?:Separate|Record|When|Use|Keep|Review|Consider|A|The|Uma?|Separar|Registrar)\b/u.test(text)) || /\p{Lu}/u.test(text.slice(1)) || words(text).some(w => vocabulary.has(w))
        || /\b(?:unique|only|unprecedented|merger|board|incident|únic[oa]|exclusiv[oa]|fusão|conselho|incidente)\b/iu.test(text)
      return !risk
    } catch { return false }
  }
}
