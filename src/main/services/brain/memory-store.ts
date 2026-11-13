import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFileSync,existsSync,mkdirSync,readdirSync,readFileSync,renameSync,statSync,realpathSync,unlinkSync,writeFileSync } from 'node:fs'
import { join, dirname, sep, relative as relativePath } from 'node:path'
import { resolveInside } from '../../safe-path'
import { randomUUID } from 'node:crypto'
import { policy, frontmatter, detections, restricted, allowedSpace, maxClass, type Classification } from '../security/classification'
import type { SpaceKeys } from '../security/keys'
import type { GitHubConfig } from '../../store'

export interface ActivityEntry {
  ts: number
  op: 'write' | 'append' | 'remove'
  path: string
  source: string // 'system' | 'ui' | 'chat' | 'sleep' | 'auto:<name>' | ...
}

export class Memory {
  // Called after every local write/append — used by GitSync to mark dirty paths
  onWrite: ((relPath: string) => void) | null = null
  // Who is writing right now — Brain methods set this so the activity
  // journal can attribute each change (sleep cycle, chat, ui, automation…)
  activitySource = 'system'
  onJournal: ((entry: ActivityEntry) => void) | null = null
  vaultCrypto: {
    encryptsPath(rel: string): boolean
    isBlob(text: string): boolean
    encrypt(text: string): string
    decrypt(text: string): string
  } | null = null
  resolve(relative: string): string { return this.path(relative) }

  // Source identity follows in-vault aliases too: a symlink must not turn
  // a dated fact document into an unfiltered generic note.
  canonicalRelative(relative: string): string {
    const path = this.path(relative)
    let ancestor = path
    while (!existsSync(ancestor)) ancestor = dirname(ancestor)
    const canonical = join(realpathSync(ancestor), relativePath(ancestor, path))
    return relativePath(realpathSync(this.dir), canonical).split(sep).join('/')
  }

  fileMtime(relative: string): number | null {
    try { return this.read(relative) === null ? null : statSync(this.path(relative)).mtimeMs } catch { return null }
  }

  // Operational data remains local and uses the same encrypted, scoped boundary.
  appendJsonl(name: string, obj: unknown) {
    const rel = this.scopePath(`ops/${name}`)
    const prior = this.read(rel)?.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') ?? ''
    this.quietWrite(rel, prior + JSON.stringify(obj) + '\n')
  }

  readJsonl(name: string, limit = 40): unknown[] {
    const raw = this.read(this.scopePath(`ops/${name}`))?.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') ?? ''
    return raw.trim().split('\n').filter(Boolean).slice(-limit).flatMap(line => {
      try { return [JSON.parse(line)] } catch { return [] }
    }).reverse()
  }

  readOpsJson<T>(name: string, fallback: T): T {
    const raw = this.read(this.scopePath(`ops/${name}`))
    if (!raw) return fallback
    try { return JSON.parse(raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')) as T } catch { return fallback }
  }

  writeOpsJson(name: string, data: unknown) {
    this.quietWrite(this.scopePath(`ops/${name}`), JSON.stringify(data))
  }

  syncWrite(relative: string, content: string) {
    if (this.read(relative) === content) return
    this.quietWrite(relative, content)
    this.journalPush('write', relative, 'sync')
  }

  syncRemove(relative: string) {
    if (this.read(relative) === null) return
    this.quietRemove(relative)
    this.journalPush('remove', relative, 'sync')
  }

  private quiet = false
  private migrating = false
  private journal: ActivityEntry[] = []
  private journalFile: string
  private journalAppends = 0

  classificationFloor: Classification = 'public'
  readonly readSpaces = new Set<string>()
  private scope = new AsyncLocalStorage<{ space: string; grants: string[] }>()
  private activeSpace = 'personal'
  private activeGrants: string[] = []
  get currentSpace() { return this.scope.getStore()?.space ?? this.activeSpace }
  set currentSpace(value: string) { this.activeSpace = value }
  get grants() { return this.scope.getStore()?.grants ?? this.activeGrants }
  set grants(value: string[]) { this.activeGrants = value }
  withScope<T>(fn: () => T): T { return this.scope.run({ space: this.currentSpace, grants: [...this.grants] }, fn) }
  keys?: SpaceKeys
  encryptAll = true
  onKeysChanged: (() => void) | null = null

  constructor(private dir: string, private gh: GitHubConfig | (() => GitHubConfig) | null, options: { allowPlaintext?: boolean } = {}) {
    this.encryptAll = options.allowPlaintext !== true
    mkdirSync(this.dir, { recursive: true })
    this.journalFile = join(this.dir, 'ops', 'activity.jsonl')
    this.loadJournal()
    // Memory tiers — modeled on human memory:
    //   short-term  = raw daily logs (working memory, recent days)
    //   medium-term = weekly consolidations of older short-term logs
    //   long-term   = durable facts, lessons, skills (never forgotten)
    //   sleep       = nightly learning reports
    //   inbox       = legacy dir kept for backward compatibility
    for (const sub of ['short-term', 'medium-term', 'long-term', 'sleep', 'inbox', 'insights', 'summaries', 'agents', 'notes', 'tasks', 'daily', 'meetings', 'entities', 'review', 'skills', 'crm', 'crm/people', 'crm/companies', 'crm/interactions', 'ops']) {
      mkdirSync(join(this.dir, sub), { recursive: true })
    }
  }

  // Containment guard: every memory path must resolve inside the memory
  // dir — blocks `..` traversal from LLM tool args, sync filenames, etc.
  private path(...parts: string[]) {
    const p = resolveInside(this.dir, ...parts)
    let ancestor = p
    while (!existsSync(ancestor)) ancestor = dirname(ancestor)
    const root = realpathSync(this.dir), target = realpathSync(ancestor)
    if (target !== root && !target.startsWith(root + sep)) throw new Error('Symlink escapes memory root')
    return p
  }

  write(relative: string, content: string) {
    const p = this.path(relative)
    mkdirSync(join(p, '..'), { recursive: true })
    if (!this.migrating && existsSync(p)) {
      let raw = readFileSync(p, 'utf8')
      if (raw.startsWith('KMS1\n')) {
        if (!this.vaultCrypto) throw new Error('Vault key unavailable')
        raw = this.vaultCrypto.decrypt(raw)
      }
      if (!raw.startsWith('KEEPMIND-ITEM:1\n') && this.encryptAll) throw new Error('Plaintext requires migration')
      if (this.read(relative) === null) throw new Error('Space access denied')
    }
    const item = policy(content, this.currentSpace)
    if (!this.migrating) item.class = maxClass(item.class, this.classificationFloor)
    if (!allowedSpace(item.space, this.currentSpace, this.grants)) throw new Error('Space access denied')
    const mustEncrypt = this.encryptAll || restricted(item.class)
    if (mustEncrypt && !this.keys) throw new Error('Memory locked: encryption keys required')
    for (const hit of detections(content).filter(h => h.secret)) {
      if (!this.keys) throw new Error('Secret store unavailable')
      const id = randomUUID()
      this.keys.secrets.put(id, hit.value)
      content = content.split(hit.value).join(`[MASKED] keychain:${id}`)
    }
    content = frontmatter(content, item)
    if (mustEncrypt) {
      this.keys!.createSpace(item.space)
      this.onKeysChanged?.()
      content = 'KEEPMIND-ITEM:1\n' + JSON.stringify({ space: item.space, box: this.keys!.encrypt(content, item.space, relative) })
    }
    if (this.vaultCrypto?.encryptsPath(relative)) content = this.vaultCrypto.encrypt(content)
    const temp = p + '.tmp'
    writeFileSync(temp, content, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, p)
    if (!this.quiet) {
      this.onWrite?.(relative)
      this.journalPush('write', relative)
    }
  }

  private attachmentPath(relative: string) {
    const p = this.path(relative), normalized = relativePath(this.dir, p)
    if (!normalized || normalized.endsWith('.md') || /^(?:ops|state|\.keepmind)(?:[\\/]|$)/.test(normalized)) throw new Error('Attachment path denied')
    return p
  }

  // Binary payloads never pass through text classification or lossy UTF-8 conversion.
  // Ownership is supplied by the importing caller, never inferred from binary data.
  writeAttachment(relative: string, data: Uint8Array, space = this.currentSpace, classification: Classification = 'secret') {
    const p = this.attachmentPath(relative)
    if (!allowedSpace(space, this.currentSpace, this.grants)) throw new Error('Space access denied')
    if (!this.keys) throw new Error('Memory locked')
    if (existsSync(p) && this.readAttachment(relative) === null) throw new Error('Space access denied')
    this.persistAttachment(relative, data, space, maxClass(classification, this.classificationFloor))
  }

  private persistAttachment(relative: string, data: Uint8Array, space: string, classification: Classification) {
    if (!this.keys) throw new Error('Memory locked')
    this.keys.createSpace(space); this.onKeysChanged?.()
    const box = this.keys.encrypt(JSON.stringify({ space, class: classification, data: Buffer.from(data).toString('base64') }), space, `attachment:${relative}`)
    const p = this.path(relative)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p + '.tmp', 'KEEPMIND-ATTACHMENT:1\n' + JSON.stringify({ space, box }), { mode: 0o600 })
    renameSync(p + '.tmp', p)
  }

  readAttachment(relative: string): Buffer | null {
    const p = this.path(relative)
    if (!existsSync(p)) return null
    const raw = readFileSync(p, 'utf8')
    if (!raw.startsWith('KEEPMIND-ATTACHMENT:1\n')) throw new Error('Plaintext attachment requires migration')
    const envelope = JSON.parse(raw.slice('KEEPMIND-ATTACHMENT:1\n'.length))
    if (!allowedSpace(envelope.space, this.currentSpace, this.grants)) return null
    if (!this.keys) throw new Error('Memory locked')
    const payload = JSON.parse(this.keys.decrypt(envelope.box, envelope.space, `attachment:${relative}`))
    if (payload.space !== envelope.space || !['public', 'internal', 'sensitive', 'secret'].includes(payload.class)) throw new Error('Invalid attachment policy')
    this.classificationFloor = maxClass(this.classificationFloor, payload.class)
    this.readSpaces.add(payload.space)
    return Buffer.from(payload.data, 'base64')
  }

  // Explicit migration map: ambiguous ownership must be resolved or quarantined by
  // the importer. An existing sealed attachment cannot be reassigned here.
  protectAttachment(relative: string, space: string) {
    if (!allowedSpace(space, this.currentSpace, this.grants)) throw new Error('Space access denied')
    const bytes = readFileSync(this.attachmentPath(relative))
    if (bytes.subarray(0, 22).toString().startsWith('KEEPMIND-ATTACHMENT:1\n')) {
      if (this.readAttachment(relative) === null) throw new Error('Space access denied')
      return false
    }
    this.persistAttachment(relative, bytes, space, 'secret')
    return true
  }

  append(relative: string, content: string) {
    this.write(relative, (this.read(relative) ?? '') + content)
  }

  // Activity journal — every local mutation is recorded to
  // ops/activity.jsonl (local-only, .jsonl so it never syncs to GitHub)
  // and kept in a ring buffer for the UI feed.
  private journalPush(op: ActivityEntry['op'], rel: string, source = this.activitySource) {
    const entry: ActivityEntry = { ts: Date.now(), op, path: rel, source }
    this.journal.push(entry)
    if (this.journal.length > 600) this.journal.splice(0, this.journal.length - 600)
    try {
      mkdirSync(join(this.dir, 'ops'), { recursive: true })
      appendFileSync(this.journalFile, JSON.stringify(entry) + '\n', 'utf8')
      // occasional rotation: keep the file bounded
      if (++this.journalAppends % 200 === 0 && existsSync(this.journalFile) && statSync(this.journalFile).size > 300_000) {
        const lines = readFileSync(this.journalFile, 'utf8').trim().split('\n')
        writeFileSync(this.journalFile, lines.slice(-2000).join('\n') + '\n', 'utf8')
      }
    } catch { /* journal is best-effort */ }
    try { this.onJournal?.(entry) } catch { /* renderer gone */ }
  }

  private loadJournal() {
    try {
      if (!existsSync(this.journalFile)) return
      const lines = readFileSync(this.journalFile, 'utf8').trim().split('\n').slice(-600)
      for (const l of lines) {
        try { this.journal.push(JSON.parse(l)) } catch { /* skip bad lines */ }
      }
    } catch { /* noop */ }
  }

  activity(limit = 200): ActivityEntry[] {
    return this.journal.filter(e => { try { return this.read(e.path) !== null } catch { return false } }).slice(-limit).reverse()
  }

  // Writes/removes that must NOT trigger a sync push (used by GitSync.pull)
  quietWrite(relative: string, content: string) {
    this.quiet = true
    try { this.write(relative, content) } finally { this.quiet = false }
  }

  quietRemove(relative: string) {
    this.quiet = true
    try { this.remove(relative) } finally { this.quiet = false }
  }

  allRelFiles(): string[] { return this.allFiles('') }

  // Explicit migration boundary: classify imported plaintext before readers/indexers see it.
  // Existing ciphertext is left untouched, preserving incremental behavior.
  protectExisting(): number {
    if (!this.keys) throw new Error('Memory locked')
    let protectedCount = 0
    for (const rel of this.allFiles('', '', true)) {
      let text = readFileSync(this.path(rel), 'utf8')
      if (text.startsWith('KMS1\n')) {
        if (!this.vaultCrypto) throw new Error('Vault key unavailable')
        text = this.vaultCrypto.decrypt(text)
      }
      if (text.startsWith('KEEPMIND-ITEM:1\n')) continue
      const item = policy(text)
      if (!allowedSpace(item.space, this.currentSpace, this.grants) || (!this.encryptAll && !restricted(item.class))) continue
      this.migrating = true
      try { this.write(rel, text); protectedCount++ } finally { this.migrating = false }
    }
    return protectedCount
  }

  read(relative: string): string | null {
    const p = this.path(relative)
    if (!existsSync(p)) return null
    let text = readFileSync(p, 'utf8')
    if (text.startsWith('KMS1\n')) {
      if (!this.vaultCrypto) throw new Error('Vault key unavailable')
      text = this.vaultCrypto.decrypt(text)
    }
    const encrypted = text.startsWith('KEEPMIND-ITEM:1\n')
    let encryptedSpace: string | undefined
    if (encrypted) {
      const item = JSON.parse(text.slice('KEEPMIND-ITEM:1\n'.length))
      encryptedSpace = item.space
      if (!allowedSpace(item.space, this.currentSpace, this.grants)) return null
      if (!this.keys) throw new Error('Memory locked')
      text = this.keys.decrypt(item.box, item.space, relative)
    }
    const item = policy(text)
    if (encrypted && encryptedSpace !== item.space) throw new Error('Space authentication mismatch')
    if (!allowedSpace(item.space, this.currentSpace, this.grants)) return null
    if ((this.encryptAll || restricted(item.class)) && !encrypted) throw new Error('Unencrypted restricted memory requires migration')
    this.classificationFloor = maxClass(this.classificationFloor, item.class)
    this.readSpaces.add(item.space)
    return text
  }

  remove(relative: string) {
    const p = this.path(relative)
    if (existsSync(p)) {
      if (this.read(relative) === null) throw new Error('Space access denied')
      unlinkSync(p)
      if (!this.quiet) {
        this.onWrite?.(relative)
        this.journalPush('remove', relative)
      }
    }
  }

  // Short-term files older than `days` are candidates for medium-term consolidation
  scopePath(relative: string) { return this.currentSpace === 'personal' || relative.startsWith('spaces/') ? relative : `spaces/${this.currentSpace}/${relative}` }

  shortTermFiles(): string[] { return this.list(this.scopePath('short-term')).sort() }
  mediumTermFiles(): string[] { return this.list(this.scopePath('medium-term')).sort() }
  longTermFiles(): string[] { return this.list(this.scopePath('long-term')).sort() }

  list(dir: string): string[] {
    const p = this.path(dir)
    return existsSync(p) ? readdirSync(p).filter(f => f.endsWith('.md') && this.read(`${dir}/${f}`) !== null) : []
  }

  async syncToGitHub(message: string) {
    const gh = typeof this.gh === 'function' ? this.gh() : this.gh
    if (!gh?.accessToken || !gh.repoOwner) return
    const github = await import('../github')
    // Push a digest of memory state — the repo is the durable backup
    const files = this.allFiles('')
    for (const rel of files.slice(0, 200)) {
      const content = this.read(rel)
      if (content != null) {
        try { await github.pushFile(gh, `${gh.syncRoot ?? 'memory/'}${rel}`, content, message) } catch { /* keep going */ }
      }
    }
  }

  countFiles(dir: string): number {
    const p = this.path(dir)
    if (!existsSync(p)) return 0
    let n = 0
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.isDirectory()) n += this.countFiles(join(dir, e.name))
      else if (e.name.endsWith('.md') && this.read(join(dir, e.name)) !== null) n++
    }
    return n
  }

  private allFiles(dir: string, prefix = '', raw = false): string[] {
    const out: string[] = []
    const p = this.path(dir)
    if (!existsSync(p)) return out
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) out.push(...this.allFiles(join(dir, e.name), rel, raw))
      else if (e.name.endsWith('.md') && (raw || this.read(rel) !== null)) out.push(rel)
    }
    return out
  }
}
