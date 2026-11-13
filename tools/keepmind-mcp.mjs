#!/usr/bin/env node
// keepmind-mcp — exposes a KeepMind memory directory over MCP (stdio).
//
// Plain Node >= 18. Encrypted access needs the full built KeepMind package.
// Zero-dependency copies support only explicitly opted-in legacy plaintext.
// Point it at an authorized clone/copy of the
// memory repo and any MCP-capable agent (Claude, Codex, Grok, Gemini, custom
// bots) gets structured read/write/search access to the brain.
//
// Usage:
//   node tools/keepmind-mcp.mjs --memory-dir /path/to/memory
//   KEEPMIND_MEMORY_DIR=/path/to/memory npx keepmind-mcp
//
// Defaults to ./memory; encrypted reads require launcher-provided unlock and scopes.

import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { readdirSync, readFileSync, writeFileSync, appendFileSync, statSync, existsSync, mkdirSync, realpathSync, renameSync } from 'node:fs'
import { join, resolve, sep, dirname, relative } from 'node:path'
import { formatFactSelection, labelMemorySource, selectFacts } from './lib/memory-contract.mjs'
import { ContinuityService, continuityTools, continuityToolActions, withProjectLock, assertNoSymlinkPath } from './lib/continuity.mjs'

// ── config ──

function configuredRoot() {
  const args = process.argv.slice(2)
  const flag = args.includes('--memory-dir') ? '--memory-dir' : '--dir'
  const position = args.indexOf(flag)
  if (position >= 0 && (!args[position + 1] || args[position + 1].startsWith('--'))) {
    process.stderr.write(`${flag} requires a directory\n`); process.exit(1)
  }
  const root = resolve((position >= 0 ? args[position + 1] : null) ?? process.env.KEEPMIND_MEMORY_DIR ?? process.env.SECOND_BRAIN_DIR ?? './memory')

  return root
}

export function createMemoryServer(memoryDir, options = {}) {
const ROOT = resolve(memoryDir)
const clientId = options.clientId ?? 'default'
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(clientId)) throw new Error('Invalid client id')
const scope = options.clients?.[clientId] ?? (options.clients ? { spaces: [], maxClass: 'public' } : { spaces: ['personal'], maxClass: 'internal' })
const learningService = options.keys && options.state && scope.owner === true && levelsAllowed(scope.maxClass) ? new (createRequire(import.meta.url)('../out/main/derived-learnings.js').DerivedLearnings)(ROOT, options.state, options.keys, { owner: true, spaces: scope.spaces }) : null
function levelsAllowed(maximum) { return ['internal', 'sensitive', 'secret'].includes(maximum) }
const encryptAll = options.allowPlaintext !== true
const levels = ['public', 'internal', 'sensitive', 'secret']
const auditFile = options.auditFile ?? safe('ops/mcp-reads.jsonl')
function authorize(content, maximum = scope.maxClass) {
  if (content.startsWith('KEEPMIND-')) return false
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const space = fm.match(/^space:\s*(\S+)/m)?.[1] ?? 'personal'
  const declared = fm.match(/^class:\s*(\S+)/m)?.[1] ?? 'internal'
  const override = fm.match(/^class_override:\s*(\S+)/m)?.[1]
  if (override !== undefined && !levels.includes(override)) return false
  let rank = levels.indexOf(declared)
  if (rank < 0) return false
  rank = Math.max(rank, override === undefined ? 0 : levels.indexOf(override))
  if (/\b(?:sk-|ghp_|xox[a-z]-|AKIA)|-----BEGIN .*PRIVATE KEY-----|\beyJ[\w-]+\.[\w-]+\.[\w-]+/.test(content)) rank = 3
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]+|(?:\+\d{8,15}\b|\b\d{10,15}\b)|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b|(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,3}\)[ .-]?|\b\d{2,3}[ .-])\d{4,5}[ .-]?\d{4}\b/.test(content)) rank = Math.max(rank, 2)
  return scope.spaces.includes(space) && rank <= levels.indexOf(maximum)
}
function audit(rel, allowed, operation = 'read') {
  mkdirSync(dirname(auditFile), { recursive: true })
  appendFileSync(auditFile, JSON.stringify({ ts: new Date().toISOString(), client: clientId, operation, resource: createHash('sha256').update(rel).digest('hex'), allowed }) + '\n', { mode: 0o600 })
}

function safe(rel) {
  const p = resolve(ROOT, String(rel ?? ''))
  if (p !== ROOT && !p.startsWith(ROOT + sep)) throw new Error(`path escapes memory root: ${rel}`)
  let ancestor = p
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor)
  if (existsSync(ROOT)) {
    const root = realpathSync(ROOT), target = realpathSync(ancestor)
    if (target !== root && !target.startsWith(root + sep)) throw new Error('symlink escapes memory root')
  }
  return p
}

function* walk(dir, prefix = '') {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) yield* walk(join(dir, e.name), rel)
    else if (e.name.endsWith('.md')) yield rel
  }
}

const allFiles = () => [...walk(ROOT)].filter(rel => readMem(rel) !== null)

function decodeMem(rel, raw) {
  if (raw.startsWith('KEEPMIND-ITEM:1\n')) {
    const envelope = JSON.parse(raw.slice('KEEPMIND-ITEM:1\n'.length))
    // Scope is checked before any attempt to unwrap a space key.
    if (!scope.spaces.includes(envelope.space)) return null
    if (!options.keys) throw new Error('Memory locked')
    const text = options.keys.decrypt(envelope.box, envelope.space, rel)
    const innerSpace = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].match(/^space:\s*(\S+)/m)?.[1]
    if (innerSpace !== envelope.space) throw new Error('Space authentication mismatch')
    return text
  }
  if (encryptAll || raw.startsWith('KEEPMIND-')) return null
  // Explicit legacy plaintext mode still refuses restricted plaintext.
  return authorize(raw, 'internal') ? raw : null
}

function readMem(rel) {
  const p = safe(rel)
  if (!existsSync(p)) return null
  let content
  try { content = decodeMem(canonicalRelative(rel), readFileSync(p, 'utf8')) }
  catch { audit(rel, false); throw new Error('Encrypted memory unavailable') }
  const allowed = content !== null && authorize(content)
  audit(rel, allowed)
  return allowed ? content : null
}

function writeMem(rel, content, append = false) {
  let allowed = false
  try {
    const p = safe(rel)
    const normalized = relative(ROOT, p).split(sep).join('/')
    // Configuration and audit trails cannot be overwritten through note tools.
    if (!rel.endsWith('.md') || resolve(p) === ROOT || /^(?:ops|state|\.keepmind)(?:[\\/]|$)/.test(relative(ROOT, p)) || p === resolve(auditFile)) throw new Error('Write path denied')
    if (scope.write !== true) throw new Error('Client write permission required')
    assertNoSymlinkPath(ROOT, normalized)
    const exists = existsSync(p)
    const previous = exists ? decodeMem(normalized, readFileSync(p, 'utf8')) : null
    if (exists && (previous === null || !authorize(previous))) throw new Error('Existing note outside client scope')
    let next = append && previous !== null ? previous + content : content
    const fm = next.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (!fm?.[1].match(/^space:/m)) {
      const previousSpace = previous?.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].match(/^space:\s*(\S+)/m)?.[1]
      const space = previousSpace ?? scope.defaultSpace ?? scope.spaces[0]
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(space ?? '')) throw new Error('Client default space required')
      next = fm ? `---\nspace: ${space}\n${fm[1]}\n---\n${next.slice(fm[0].length)}` : `---\nspace: ${space}\nclass: internal\n---\n${next}`
    }
    // Ambiguous policy fields fail closed; do not let appending/overwriting
    // downgrade a protected note or reinterpret duplicate frontmatter keys.
    const fields = next.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
    if (['space', 'class', 'class_override'].some(key => [...fields.matchAll(new RegExp(`^${key}:`, 'gm'))].length > 1)) throw new Error('Ambiguous note policy')
    if (!authorize(next)) throw new Error('New note outside client scope')
    // Encrypt every class by default; secret capture remains native-only.
    const classification = fields.match(/^class:\s*(\S+)/m)?.[1] ?? 'internal'
    const override = fields.match(/^class_override:\s*(\S+)/m)?.[1]
    const protectedWrite = encryptAll || levels.indexOf(classification) >= 2 || levels.indexOf(override) >= 2 || !authorize(next, 'internal')
    if (protectedWrite) {
      if (!options.keys) throw new Error('Encrypted writes require unlocked keys')
      // Secret capture belongs to native keychain-backed Memory, never this process.
      if (/\b(?:sk-|ghp_|xox[a-z]-|AKIA)|-----BEGIN .*PRIVATE KEY-----|\beyJ[\w-]+\.[\w-]+\.[\w-]+/.test(next)) throw new Error('Native secret capture required')
      const space = fields.match(/^space:\s*(\S+)/m)?.[1]
      // Do not create unpersisted keys: setup/configure spaces in the native app.
      if (!options.keys.config.spaces[space]) throw new Error('Space key unavailable')
      next = 'KEEPMIND-ITEM:1\n' + JSON.stringify({ space, box: options.keys.encrypt(next, space, normalized) })
    }
    mkdirSync(dirname(p), { recursive: true })
    // Audit authorization before mutation: an unavailable audit sink denies writes.
    audit(rel, true, 'write')
    allowed = true
    const temp = p + '.tmp'
    if (existsSync(temp)) throw new Error('Write already pending')
    writeFileSync(temp, next, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temp, p)
    return rel
  } catch (error) {
    if (!allowed) audit(rel, false, 'write')
    throw error
  }
}

function canonicalAbsolute(path) {
  let ancestor = path
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor)
  return join(realpathSync(ancestor), relative(ancestor, path))
}

function canonicalRelative(rel) {
  return relative(canonicalAbsolute(ROOT), canonicalAbsolute(safe(rel))).split(sep).join('/')
}

function isFactsPath(rel) {
  return /(?:^|\/)long-term\/facts\.md$/i.test(canonicalRelative(rel))
}

function isProjectPath(rel) {
  const protectedPath = /^(?:spaces\/[^/]+\/)?projects\//i
  return protectedPath.test(relative(ROOT, safe(rel)).split(sep).join('/')) || protectedPath.test(canonicalRelative(rel))
}

function guardGenericWrite(rel) {
  try {
    if (isProjectPath(rel)) throw new Error('Use continuity tools to update projects with an expectedRevision')
  } catch (error) {
    // Rejections before writeMem still count as attempted writes.
    audit(rel, false, 'write')
    throw error
  }
}

function defaultSpacePath(rel) {
  const space = scope.defaultSpace ?? scope.spaces[0]
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(space ?? '') || !scope.spaces.includes(space)) throw new Error('Client default space required')
  return space === 'personal' ? rel : `spaces/${space}/${rel}`
}

function selectionArgs(args = {}) {
  const mode = args.mode ?? (args.asOf ? 'asOf' : 'current')
  const selection = { mode, asOf: args.asOf }
  // Validate even if the authorized collection has no fact files.
  selectFacts('', selection)
  return selection
}

function sourcePolicy(raw) {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const space = fm.match(/^space:\s*(\S+)/m)?.[1] ?? 'personal'
  const rank = levels.findIndex(level => authorize(raw, level))
  return `space: ${space}; class: ${levels[rank] ?? 'unavailable'}`
}

function memoryForAgent(rel, raw, selection) {
  const normalized = canonicalRelative(rel)
  const version = createHash('sha256').update(raw).digest('hex')
  if (selection.mode === 'asOf' && !isFactsPath(rel)) return `[source: ${normalized}; sha256: ${version}; ${sourcePolicy(raw)}]\nNo dated fact selection is available for this source. Use current or history to read it as unverified source material.`
  const body = isFactsPath(rel) ? formatFactSelection(raw, selection) : raw
  const status = isFactsPath(rel) ? `fact selection: ${selection.mode}${selection.asOf ? ` as of ${selection.asOf}` : ''}` : labelMemorySource(normalized)
  return `[source: ${normalized}; sha256: ${version}; ${sourcePolicy(raw)}; ${status}]\n${body || '(No facts match this selection.)'}`
}

let continuityClassFloor = 0
const continuity = new ContinuityService({
  assertEvidencePath: rel => assertNoSymlinkPath(ROOT, rel),
  space: () => {
    const space = scope.defaultSpace ?? scope.spaces[0]
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(space ?? '') || !scope.spaces.includes(space)) throw new Error('Project space unavailable')
    return space
  },
  scopePath: rel => {
    const space = scope.defaultSpace ?? scope.spaces[0]
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(space ?? '') || !scope.spaces.includes(space)) throw new Error('Project space unavailable')
    return space === 'personal' ? rel : `spaces/${space}/${rel}`
  },
  read: rel => {
    const text = readMem(rel)
    if (text !== null) {
      const required = levels.findIndex(level => authorize(text, level))
      if (required < 0) throw new Error('Project source unavailable')
      continuityClassFloor = Math.max(continuityClassFloor, required)
    }
    return text
  },
  write: (rel, content) => {
    // Inherit the strongest classification of every source and record read
    // by this operation, matching the native Memory classification floor.
    const classification = levels[continuityClassFloor]
    const fields = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
    const declared = levels.indexOf(fields.match(/^class:\s*(\S+)/m)?.[1] ?? 'internal')
    if (continuityClassFloor > declared) {
      content = /^class:/m.test(fields)
        ? content.replace(/^class:[^\r\n]*$/m, `class: ${classification}`)
        : content.replace(/^---\r?\n/, `---\nclass: ${classification}\n`)
    }
    writeMem(rel, content)
  },
  list: dir => existsSync(safe(dir)) ? readdirSync(safe(dir), { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name) : [],
  withLock: (rel, fn) => {
    if (scope.write !== true) {
      audit(rel, false, 'write')
      throw new Error('Client write permission required')
    }
    return withProjectLock(safe(rel), fn)
  }
})

function proposeFact(text, source, supersedes = '', target = defaultSpacePath('long-term/facts.md')) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length < 3) return 'proposta vazia'
  const today = new Date().toISOString().slice(0, 10)
  const id = `p-${Math.random().toString(36).slice(2, 8)}`
  const block = [
    `### ${id}`,
    `- since: ${today}`,
    `- until:`,
    `- source: ${source}`,
    `- origin: mcp`,
    `- supersedes: ${supersedes}`,
    `- superseded-by:`,
    '',
    clean,
    ''
  ].join('\n')
  const current = readMem(target) ?? ''
  const frontmatter = current.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? ''
  const body = current.slice(frontmatter.length)
  const structured = /^## (Ativos|Arquivo|Legado)\s*$/m.test(body)
  const base = /^## Propostas\s*$/m.test(body)
    ? current
    : `${frontmatter}${structured ? body.trim() : `# Fatos\n\n## Legado\n\n${body.trim()}\n\n## Ativos\n\n## Arquivo`}\n\n## Propostas\n`
  const next = `${base.replace(/\s*$/, '')}\n${block}`
  writeMem(target, next.endsWith('\n') ? next : `${next}\n`)
  return id
}

// ── lexical search (BM25-ish, no deps) ──

const STOP = new Set(('the a an and or of to in on for with is are was were be been it its this that you your we our they their he she i me my not no do does did have has had will would can could should about as at by from into over after before between under again further then once here there when where why how all any both each few more most other some such only own same so than too very just also').split(' '))

function terms(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) ?? [])
    .filter(w => w.length > 2 && !STOP.has(w))
}

function search(query, limit = 8, selection = { mode: 'current' }) {
  const qTerms = [...new Set(terms(query))]
  if (!qTerms.length) return 'empty query'
  const derived = selection.mode !== 'asOf' && learningService ? learningService.list(query, false).map(r => `## ${r.id}\n${r.body}`).join('\n\n') : ''
  const qSet = new Set(qTerms)
  const results = []
  for (const rel of allFiles()) {
    if (selection.mode === 'asOf' && !isFactsPath(rel)) continue
    const raw = readMem(rel)
    if (!raw) continue
    const content = isFactsPath(rel) ? formatFactSelection(raw, selection) : raw
    if (!content.trim()) continue
    const words = terms(content)
    if (!words.length) continue
    let score = 0
    const counts = new Map()
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1)
    for (const t of qTerms) {
      const c = counts.get(t) ?? 0
      if (c) score += Math.min(c, 5) * (t.length > 4 ? 2 : 1)
    }
    // phrase bonus
    const lower = content.toLowerCase()
    if (lower.includes(query.toLowerCase())) score += 10
    if (score <= 0) continue
    // snippet: first line containing a query term
    const lines = content.split('\n')
    const index = Math.max(0, lines.findIndex(l => qTerms.some(t => l.toLowerCase().includes(t))))
    let start = index
    if (isFactsPath(rel)) while (start > 0 && !lines[start].startsWith('[')) start--
    const excerpt = lines.slice(start, Math.max(index + 2, start + 3)).join('\n').slice(0, 1200)
    const version = createHash('sha256').update(raw).digest('hex')
    const sourceLabel = isFactsPath(rel) ? `fact selection: ${selection.mode}` : labelMemorySource(rel)
    results.push({ rel, score, snippet: `[${sourceLabel}; sha256: ${version}; ${sourcePolicy(raw)}]\n${excerpt}` })
  }
  results.sort((a, b) => b.score - a.score)
  if (!results.length) {
    return derived || `no matches for "${query}"`
  }
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 8))
  return [selection.mode === 'asOf' ? '' : derived, results.slice(0, safeLimit).map(r =>
    `## ${r.rel} (score ${r.score})\n${r.snippet}`).join('\n\n')].filter(Boolean).join('\n\n')
}

// ── tasks (memory/tasks/*.md — "# title" + "> status: …" meta line) ──

function listTasks(status) {
  const dir = join(ROOT, 'tasks')
  if (!existsSync(dir)) return 'no tasks yet'
  const out = []
  for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const c = readMem(`tasks/${f}`)
    if (c === null) continue
    const title = (c.split('\n').find(l => l.startsWith('# ')) ?? '# ').slice(2).trim()
    const meta = (c.split('\n').find(l => l.startsWith('> ')) ?? '').replace(/^>\s*/, '')
    const done = /status:\s*done/.test(meta)
    const due = meta.match(/due:\s*(\S+)/)?.[1] ?? ''
    const pri = meta.match(/priority:\s*(\S+)/)?.[1] ?? 'normal'
    if (status === 'open' && done) continue
    if (status === 'done' && !done) continue
    out.push(`${done ? '[x]' : '[ ]'} ${title}${pri !== 'normal' ? ` (${pri})` : ''}${due ? ` — due ${due}` : ''} · tasks/${f}`)
  }
  return out.length ? out.join('\n') : `no ${status ?? ''} tasks`
}

// ── structured query: filter tasks / notes / entities ──

function parseTaskMeta(c) {
  const title = (c.split('\n').find(l => l.startsWith('# ')) ?? '# ').slice(2).trim()
  const meta = (c.split('\n').find(l => l.startsWith('> ')) ?? '').replace(/^>\s*/, '')
  return {
    title, meta, done: /status:\s*done/.test(meta),
    due: meta.match(/due:\s*(\S+)/)?.[1] ?? '',
    pri: meta.match(/priority:\s*(\S+)/)?.[1] ?? 'normal'
  }
}

function queryMem(a = {}) {
  const kind = String(a.kind ?? 'tasks')
  const limit = Math.min(a.limit ?? 20, 100)
  const text = String(a.text ?? '').toLowerCase()
  const match = (s) => !text || String(s).toLowerCase().includes(text)

  if (kind === 'tasks') {
    const dir = join(ROOT, 'tasks')
    if (!existsSync(dir)) return 'no tasks yet'
    const out = []
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const c = readMem(`tasks/${f}`)
      if (c === null) continue
      const t = parseTaskMeta(c)
      if (a.status === 'open' && t.done) continue
      if (a.status === 'done' && !t.done) continue
      if (a.priority && t.pri !== a.priority) continue
      if (a.dueBefore && t.due && t.due >= String(a.dueBefore)) continue
      if (a.dueAfter && t.due && t.due <= String(a.dueAfter)) continue
      if (a.overdue === true && (!t.due || t.done || t.due >= new Date().toISOString().slice(0, 10))) continue
      if (!match(t.title) && !match(c.slice(0, 400))) continue
      out.push(`${t.done ? '[x]' : '[ ]'} ${t.title} · ${t.pri}${t.due ? ` · due ${t.due}` : ''} · tasks/${f}`)
    }
    return out.length ? out.slice(0, limit).join('\n') : 'no matching tasks'
  }

  if (kind === 'notes') {
    const files = allFiles().filter(f => f.startsWith('notes/'))
    const out = []
    for (const f of files) {
      const c = readMem(f) ?? ''
      const title = (c.split('\n').find(l => l.startsWith('# ')) ?? f).slice(2).trim()
      const tags = [...c.matchAll(/#([\p{L}\p{N}_-]{2,})/gu)].map(m => m[1].toLowerCase())
      if (a.tag && !tags.includes(String(a.tag).toLowerCase().replace(/^#/, ''))) continue
      if (!match(title) && !match(c.slice(0, 800))) continue
      out.push(`${title} · ${f}${tags.length ? ` · #${[...new Set(tags)].slice(0, 5).join(' #')}` : ''}`)
    }
    return out.length ? out.slice(0, limit).join('\n') : 'no matching notes'
  }

  if (kind === 'crm') {
    const files = allFiles().filter(f => f.startsWith('crm/'))
    const out = []
    for (const f of files) {
      const c = readMem(f) ?? ''
      const title = (c.split('\n').find(l => l.startsWith('# ')) ?? f).slice(2).trim()
      const role = c.match(/^role:\s*(.+)$/m)?.[1]?.trim() ?? ''
      const company = c.match(/^company:\s*(.+)$/m)?.[1]?.trim() ?? ''
      if (!match(title) && !match(c.slice(0, 800))) continue
      out.push(`${title}${role ? ` · ${role}` : ''}${company ? ` @ ${company}` : ''} · ${f}`)
    }
    return out.length ? out.slice(0, limit).join('\n') : 'no matching crm entries'
  }

  if (kind === 'entities') {
    const idx = readMem('entities/index.md') ?? ''
    const rows = idx.split('\n').filter(l => l.includes('[['))
    const out = rows.filter(l => match(l)).map(l => l.replace(/^- /, '').trim())
    return out.length ? out.slice(0, limit).join('\n') : 'no matching entities'
  }

  if (kind === 'files' || kind === 'memory') {
    const dir = String(a.dir ?? '').replace(/\/$/, '')
    const out = allFiles()
      .filter(f => (!dir || f === dir || f.startsWith(dir + '/')) && match(readMem(f) ?? ''))
      .slice(0, limit)
    return out.length ? out.join('\n') : 'no matching files'
  }

  return `unknown kind "${kind}" — use tasks|notes|entities|files`
}

// ── tools ──

const TOOLS = [
  ...continuityTools.filter(t => !['review_decision', 'acknowledge_evidence', 'feedback', 'review_analysis', 'review_outcome_lesson'].includes(continuityToolActions[t.name])),
  ...['learning_list', 'learning_search', 'learning_check_public'].map(name => ({ name, description: 'Private owner learning access; never approves or publishes.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, id: { type: 'string' }, text: { type: 'string' } } } })),
  { name: 'search', description: 'Keyword search over local Markdown memory.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['query'] } },
  { name: 'read_note', description: 'Read a note relative to the local memory directory.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  {
    name: 'sb_search',
    description: 'Search the second-brain memory (Markdown files) for a query. Returns matching files with snippets. Use this BEFORE answering questions about the user — their knowledge lives here.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'search terms' },
      limit: { type: 'number', description: 'max results (default 8)' }
    }, required: ['query'] }
  },
  {
    name: 'sb_read',
    description: 'Read a memory file by path relative to the memory root (e.g. "long-term/facts.md", "notes/x.md", "short-term/2026-01-01.md").',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'sb_write',
    description: 'Write (create or overwrite) a memory file. Use for notes/, long-term/, tasks/, daily/ etc. Path relative to memory root. long-term/facts.md cannot be overwritten.',
    inputSchema: { type: 'object', properties: {
      path: { type: 'string' }, content: { type: 'string' }
    }, required: ['path', 'content'] }
  },
  {
    name: 'sb_append',
    description: 'Append content to a memory file (creates it if missing).',
    inputSchema: { type: 'object', properties: {
      path: { type: 'string' }, content: { type: 'string' }
    }, required: ['path', 'content'] }
  },
  {
    name: 'sb_supersede',
    description: 'Propose a replacement for an active fact id (f-…). The proposal waits for the person. It does not overwrite long-term/facts.md.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'active fact id, f-…' },
      content: { type: 'string', description: 'the replacement fact' }
    }, required: ['id', 'content'] }
  },
  {
    name: 'sb_remember',
    description: 'Propose a durable fact, lesson, skill or decision. It waits in Hoje until the person accepts it. kind note still writes a file immediately. kind: fact|lesson|skill|note|decision.',
    inputSchema: { type: 'object', properties: {
      content: { type: 'string', description: 'the thing to remember' },
      kind: { type: 'string', enum: ['fact', 'lesson', 'skill', 'note', 'decision'], description: 'default fact' }
    }, required: ['content'] }
  },
  {
    name: 'sb_recent',
    description: 'List memory files modified in the last N days (default 7), newest first — "what happened lately".',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } } }
  },
  {
    name: 'sb_list',
    description: 'List Markdown files under a memory subdirectory (e.g. "notes", "tasks", "entities"). Empty dir = whole memory.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string' } } }
  },
  {
    name: 'sb_tree',
    description: 'Full recursive listing of every memory file.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sb_tasks',
    description: 'List tasks from memory/tasks/. status: open|done|all.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'done', 'all'] } } }
  },
  {
    name: 'sb_query',
    description: 'Structured query over memory. kind: tasks|notes|entities|files. Filters: text (substring), tag (notes), status/priority/dueBefore/dueAfter/overdue (tasks), dir (files), limit.',
    inputSchema: { type: 'object', properties: {
      kind: { type: 'string', enum: ['tasks', 'notes', 'entities', 'files', 'crm'] },
      text: { type: 'string' }, tag: { type: 'string' }, dir: { type: 'string' },
      status: { type: 'string' }, priority: { type: 'string' },
      dueBefore: { type: 'string', description: 'YYYY-MM-DD' },
      dueAfter: { type: 'string', description: 'YYYY-MM-DD' },
      overdue: { type: 'boolean' },
      limit: { type: 'number' }
    } }
  }
]

for (const tool of TOOLS) {
  if (['search', 'sb_search', 'read_note', 'sb_read'].includes(tool.name)) {
    Object.assign(tool.inputSchema.properties, {
      mode: { type: 'string', enum: ['current', 'history', 'asOf'], description: 'Facts default to current. Explicit history includes labeled proposals. asOf selects dated facts only.' },
      asOf: { type: 'string', description: 'YYYY-MM-DD for an explicit historical fact lookup.' }
    })
    tool.description += ' Current facts are selected consistently; old notes remain explicitly unverified or historical.'
  }
}

function callTool(name, a = {}) {
  if (Object.hasOwn(continuityToolActions, name)) {
    continuityClassFloor = 0
    // Authority comes only from this adapter, never model-supplied arguments.
    return JSON.stringify(continuity.dispatch(continuityToolActions[name], a, 'agent'))
  }
  switch (name) {
    case 'learning_list':
    case 'learning_search':
    case 'learning_check_public': {
      if (!learningService) throw new Error('Learning unavailable')
      return JSON.stringify(name === 'learning_check_public' ? learningService.checkPublic(String(a.id ?? ''), String(a.text ?? '')) : learningService.list(name === 'learning_search' ? String(a.query ?? '') : undefined, false))
    }
    case 'search':
    case 'sb_search': return search(String(a.query ?? ''), a.limit ?? 8, selectionArgs(a))
    case 'read_note':
    case 'sb_read': {
      const rel = String(a.path ?? '')
      const selection = selectionArgs(a)
      const c = readMem(rel)
      return c === null ? `not found: ${rel}` : memoryForAgent(rel, c, selection)
    }
    case 'sb_write': {
      const rel = String(a.path ?? '')
      guardGenericWrite(rel)
      if (isFactsPath(rel)) {
        audit(rel, false, 'write')
        throw new Error('long-term/facts.md is not overwritten. Use sb_remember or sb_supersede; the person accepts it in Hoje.')
      }
      return `wrote ${writeMem(rel, String(a.content ?? ''))}`
    }
    case 'sb_append': {
      const rel = String(a.path ?? '')
      guardGenericWrite(rel)
      if (isFactsPath(rel)) return `proposal ${proposeFact(String(a.content ?? ''), 'mcp append', '', rel)} waiting in Hoje`
      return `appended to ${writeMem(rel, String(a.content ?? ''), true)}`
    }
    case 'sb_remember': {
      const kind = ['fact', 'lesson', 'skill', 'note', 'decision'].includes(a.kind) ? a.kind : 'fact'
      if (kind !== 'note') return `proposal ${proposeFact(String(a.content ?? ''), `mcp remember · ${kind}`)} waiting in Hoje`
      const file = kind === 'note' ? `long-term/notes/${slug(String(a.content).split('\n')[0]).slice(0, 60)}.md`
        : kind === 'decision' ? 'long-term/decisions.md'
        : `long-term/${kind}s.md`
      const entry = kind === 'note'
        ? `# ${String(a.content).split('\n')[0]}\n\n${a.content}\n\n---\nsaved ${new Date().toISOString()}\n`
        : `\n- ${String(a.content).replace(/\n+/g, ' ').trim()}\n`
      return `remembered → ${writeMem(file, entry, kind !== 'note')}`
    }
    case 'sb_supersede': {
      const id = String(a.id ?? '')
      if (!/^f-[a-z0-9]+$/i.test(id)) return 'invalid fact id'
      return `proposal ${proposeFact(String(a.content ?? ''), 'mcp supersede', id)} waiting in Hoje`
    }
    case 'sb_recent': {
      const days = a.days ?? 7
      const cutoff = Date.now() - days * 864e5
      const rows = allFiles()
        .map(rel => ({ rel, m: statSync(safe(rel)).mtimeMs }))
        .filter(r => r.m >= cutoff)
        .sort((x, y) => y.m - x.m)
      return rows.length ? rows.map(r => `${new Date(r.m).toISOString().slice(0, 10)}  ${r.rel}`).join('\n') : `nothing in the last ${days} days`
    }
    case 'sb_list': {
      const dir = String(a.dir ?? '')
      const files = allFiles().filter(f => !dir || f === dir || f.startsWith(dir.replace(/\/$/, '') + '/'))
      return files.length ? files.join('\n') : '(empty)'
    }
    case 'sb_tree': return allFiles().join('\n') || '(empty memory)'
    case 'sb_tasks': return listTasks(a.status && a.status !== 'all' ? a.status : undefined)
    case 'sb_query': return queryMem(a)
    default: throw new Error(`unknown tool: ${name}`)
  }
}

function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note'
}

// ── MCP stdio JSON-RPC ──

const PROTOCOL_VERSION = '2024-11-05'

function ok(id, result) { return { jsonrpc: '2.0', id, result } }
function err(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } } }

function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined) return null // JSON-RPC notifications never receive responses
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'keepmind', version: '1.0.0' }
    })
  }
  if (method === 'ping') return ok(id, {})
  if (method === 'tools/list') return ok(id, { tools: TOOLS })
  if (method === 'tools/call') {
    try {
      const text = callTool(params?.name, params?.arguments ?? {})
      return ok(id, { content: [{ type: 'text', text: String(text) }] })
    } catch (e) {
      return ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true })
    }
  }
  if (method === 'resources/list') {
    const resources = allFiles().slice(0, 500).map(rel => ({
      uri: `memory://${rel}`,
      name: rel,
      mimeType: 'text/markdown'
    }))
    return ok(id, { resources })
  }
  if (method === 'resources/read') {
    const uri = String(params?.uri ?? '')
    if (!uri.startsWith('memory://')) return err(id, -32602, 'unsupported uri')
    const rel = uri.slice('memory://'.length)
    const c = readMem(rel)
    if (c == null) return err(id, -32002, `not found: ${rel}`)
    return ok(id, { contents: [{ uri, mimeType: 'text/markdown', text: memoryForAgent(rel, c, { mode: 'current' }) }] })
  }
  if (id === undefined) return null // notification — no response
  return err(id, -32601, `method not found: ${method}`)
}

return msg => {
  try { return handle(msg) }
  catch { return msg?.id === undefined ? null : err(msg.id, -32000, 'Memory unavailable') }
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = configuredRoot()
  const config = process.env.KEEPMIND_MCP_SCOPES ? JSON.parse(readFileSync(process.env.KEEPMIND_MCP_SCOPES, 'utf8')) : undefined
  let keys
  if (process.env.KEEPMIND_MCP_UNLOCK_FD !== undefined) {
    const fd = Number(process.env.KEEPMIND_MCP_UNLOCK_FD)
    if (!Number.isInteger(fd) || fd < 3) throw new Error('Unlock requires a dedicated inherited descriptor')
    const state = process.env.KEEPMIND_MCP_STATE
    if (!state) throw new Error('Encryption state directory required')
    const require = createRequire(import.meta.url)
    const { SpaceKeys } = require('../out/main/mcp-keys.js')
    const keyConfig = JSON.parse(readFileSync(join(state, 'security', 'memory-keys.json'), 'utf8'))
    const secrets = { put() {}, get() { throw new Error('Keychain unavailable') }, remove() { throw new Error('Keychain unavailable') } }
    try { keys = await SpaceKeys.unlock(keyConfig, secrets, { passphrase: readFileSync(fd, 'utf8').replace(/\r?\n$/, '') }) }
    catch { process.stderr.write('KeepMind unlock failed\n'); process.exit(1) }
    // Encryption defaults independently of legacy config; plaintext requires launcher opt-in.
    process.once('exit', () => keys.lock())
  }
  const handle = createMemoryServer(root, { keys, state: process.env.KEEPMIND_MCP_STATE, allowPlaintext: process.env.KEEPMIND_MCP_ALLOW_PLAINTEXT === 'true', clients: config, clientId: process.env.KEEPMIND_MCP_CLIENT ?? 'default' })
  const rl = createInterface({ input: process.stdin, terminal: false })
  rl.on('line', line => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try { msg = JSON.parse(trimmed) } catch { return }
    const res = handle(msg)
    if (res) process.stdout.write(JSON.stringify(res) + '\n')
  })
  process.stderr.write('[keepmind-mcp] serving scoped memory\n')
}
