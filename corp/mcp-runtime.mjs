import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { rankMemoryFiles } from './search-hybrid.mjs'
import { memoryRel } from './memory-layout.mjs'
import { resolveInside, canReadFile, canWriteFile, scanText, accessCtxForUser } from './lib.mjs'

export const MCP_TOOLS = [
  { name: 'sb_search', description: 'Search corporate memory (hybrid rank).' },
  { name: 'sb_read', description: 'Read a memory file by relative path.' },
  { name: 'sb_append', description: 'Append markdown to a file (inbox/short-term).' },
  { name: 'sb_list', description: 'List visible memory paths.' }
]

function auditMcp(vault, row) {
  const file = path.join(vault, 'ops', 'mcp-invocations.jsonl')
  mkdirSync(path.dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(row)}\n`)
}

export function invokeCorpMcpTool({
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
    const out = dispatch(tool, args, { vault, user, org, ctx, memoryFiles, readAbs })
    detail = typeof out === 'string' ? out.slice(0, 500) : JSON.stringify(out).slice(0, 500)
    return out
  } catch (e) {
    ok = false
    detail = e.message || String(e)
    throw e
  } finally {
    auditMcp(vault, {
      ts: new Date().toISOString(),
      agentId,
      userId: user.id,
      tool,
      ms: Date.now() - started,
      ok,
      // Query/path/text preview (truncated) so auditors can see WHAT was
      // searched, read or appended — not just that a call happened.
      args: JSON.stringify(args ?? {}).slice(0, 400),
      detail
    })
  }
}

function dispatch(tool, args, env) {
  const name = String(tool || '').trim()
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
  return located.abs
}

export function fileMtime(abs) {
  try {
    return statSync(abs).mtimeMs
  } catch {
    return 0
  }
}
