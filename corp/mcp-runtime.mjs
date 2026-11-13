import { extractCrmCapture } from '../tools/lib/crm-assistant.mjs'
import { corpCrm } from './crm-api.mjs'
import { crmAgentResult, crmTools } from '../tools/lib/crm-tools.mjs'
import { assertNoSymlinkPath } from '../tools/lib/continuity.mjs'
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { rankMemoryFiles } from './search-hybrid.mjs'
import { memoryRel } from './memory-layout.mjs'
import { resolveInside, canReadFile, canWriteFile, scanText, accessCtxForUser } from './lib.mjs'

export const MCP_TOOLS = [
  { name: 'sb_search', description: 'Search corporate memory (hybrid rank).' },
  { name: 'sb_read', description: 'Read a memory file by relative path.' },
  { name: 'sb_append', description: 'Append markdown to a file (inbox/short-term).' },
  { name: 'sb_list', description: 'List visible memory paths.' },
  ...crmTools
]

function auditMcp(vault, row) {
  const file = path.join(vault, 'ops', 'mcp-invocations.jsonl')
  mkdirSync(path.dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(row)}\n`)
}

const clip = (s, n) => String(s ?? '').slice(0, n)

// Secret-looking fragments are masked before anything lands in the audit log.
function redact(s) {
  return clip(String(s ?? ''), 400)
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/\b(sk|pk|ak|key|token|secret|password|api[_-]?key)[-_]?[a-z0-9]{8,}\b/gi, '[redacted]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]')
}

// Per-tool safe arg summary: enough for forensics, never the full payload.
function auditArgs(tool, args) {
  if (String(tool).startsWith('crm_')) return { omitted: true }
  const a = args && typeof args === 'object' ? args : {}
  switch (tool) {
    case 'sb_search':
      return { query: clip(redact(a.query ?? a.q), 200) }
    case 'sb_read':
      return { path: clip(redact(a.path ?? a.rel), 200) }
    case 'sb_append': {
      const text = String(a.text ?? a.content ?? '')
      return {
        path: clip(redact(a.path), 200),
        textLen: text.length,
        preview: clip(redact(text), 120)
      }
    }
    case 'sb_list':
      return { limit: Number(a.limit || 80) }
    default:
      return { raw: clip(redact(JSON.stringify(a)), 300) }
  }
}

export async function invokeCorpMcpTool({
  vault,
  org,
  user,
  agentId,
  tool,
  args,
  memoryFiles,
  readAbs
}) {
  const ctx = accessCtxForUser(user, org)
  const started = Date.now()
  let ok = true
  let detail = ''
  try {
    const out = await dispatch(tool, args, { vault, user, org, ctx, memoryFiles, readAbs })
    // Keep a short result preview for forensics; full memory content stays out
    // of the audit trail.
    detail = String(tool).startsWith('crm_') ? '[CRM result omitted]' : (typeof out === 'string' ? clip(redact(out), 300) : clip(redact(JSON.stringify(out)), 300))
    return out
  } catch (e) {
    ok = false
    detail = clip(redact(e.message || String(e)), 300)
    throw e
  } finally {
    auditMcp(vault, {
      ts: new Date().toISOString(),
      agentId,
      userId: user.id,
      tool,
      ms: Date.now() - started,
      ok,
      // Safe per-tool arg summary (redacted, truncated) so auditors can see
      // WHAT was searched, read or appended — not just that a call happened.
      args: auditArgs(tool, args),
      detail
    })
  }
}

async function dispatch(tool, args, env) {
  const name = String(tool || '').trim()
  if (name.startsWith('crm_')) {
    const action = name.slice(4)
    if (action === 'capture') args = { ...(args || {}), extraction: (await extractCrmCapture(args?.text, { timeZone: args?.timeZone })).extraction }
    return JSON.stringify(crmAgentResult(corpCrm(env.vault, env.org, env.user, args?.board || 'personal').dispatch(action, args || {}, 'agent'), args))
  }
  switch (name) {
    case 'sb_search':
      return search(env, String(args?.query || args?.q || '').trim())
    case 'sb_read':
      return read(env, String(args?.path || args?.rel || '').trim())
    case 'sb_append':
      return append(env, String(args?.path || 'inbox/capture.md').trim(), String(args?.text || args?.content || ''))
    case 'sb_list':
      return list(env, Number(args?.limit || 80))
    default: {
      const err = new Error(`Unknown tool: ${name}`)
      err.code = 'bad_tool'
      throw err
    }
  }
}

function search(env, query) {
  if (!query) return '[]'
  const ranked = rankMemoryFiles(env.memoryFiles, query, (f) => env.readAbs(f.abs))
  return JSON.stringify(
    ranked.slice(0, 12).map((r) => ({
      path: r.file.rel.replace(/^people\/[^/]+\/memory\//, ''),
      snippet: r.snippet.replace(/\s+/g, ' ').slice(0, 240)
    })),
    null,
    2
  )
}

function read(env, rel) {
  if (!rel) throw new Error('path required')
  const abs = pathForUser(env, rel)
  if (!abs) throw new Error('forbidden path')
  const raw = env.readAbs(abs)
  if (raw.startsWith('KMS1\n')) throw new Error('encrypted file')
  return raw
}

function append(env, rel, text) {
  const block = String(text || '').trim()
  if (!block) throw new Error('empty text')
  if (!rel.endsWith('.md')) rel = `${rel}.md`
  const full = memoryRel(env.user.id, rel)
  const located = resolveInside(env.vault, full)
  if (!located || !canWriteFile(env.user.role, env.user.id, located.rel)) throw new Error('forbidden write')
  assertNoSymlinkPath(env.vault, located.rel)
  const found = scanText(located.rel, block)
  if (found.secrets.length) {
    const err = new Error('secret_blocked')
    err.code = 'secret_blocked'
    throw err
  }
  const stamp = new Date().toISOString()
  const chunk = `\n\n## MCP ${stamp}\n${block}\n`
  if (existsSync(located.abs)) writeFileSync(located.abs, readFileSync(located.abs, 'utf8') + chunk)
  else {
    mkdirSync(path.dirname(located.abs), { recursive: true })
    writeFileSync(located.abs, `# ${path.basename(rel, '.md')}\n${chunk}`)
  }
  return `appended ${rel}`
}

function list(env, limit) {
  const paths = env.memoryFiles
    .slice(0, Math.max(1, Math.min(200, limit)))
    .map((f) => f.rel.replace(/^people\/[^/]+\/memory\//, ''))
  return JSON.stringify(paths, null, 2)
}

function pathForUser(env, rel) {
  const full = memoryRel(env.user.id, rel)
  const located = resolveInside(env.vault, full)
  if (!located || !canReadFile(env.user.role, env.user.id, located.rel, env.ctx)) return null
  try { assertNoSymlinkPath(env.vault, located.rel) } catch { return null }
  return located.abs
}

export function fileMtime(abs) {
  try {
    return statSync(abs).mtimeMs
  } catch {
    return 0
  }
}
