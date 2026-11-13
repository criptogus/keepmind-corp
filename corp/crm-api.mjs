import { getLlmSecret } from './llm-secrets.mjs'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { CrmService } from '../tools/lib/crm.mjs'
import { extractCrmCapture } from '../tools/lib/crm-assistant.mjs'
import { scanText } from './lib.mjs'
import { assertTeamBudget, recordTeamUsage, UNIT_CHAT_CLOUD } from './team-usage.mjs'
import { recordByokUsage } from './byok-meter.mjs'
import { assertNoSymlinkPath, withProjectLock } from '../tools/lib/continuity.mjs'

const MUTATIONS = new Set(['create_contact', 'update_contact', 'record_interaction', 'create_commitment', 'update_commitment', 'create_opportunity', 'update_opportunity', 'prepare_draft', 'update_draft', 'capture', 'review', 'settings', 'merge_contacts', 'undo_merge', 'import_legacy'])
const AGENT_ACTIONS = new Set(['snapshot', 'context', 'create_contact', 'update_contact', 'record_interaction', 'create_commitment', 'update_commitment', 'create_opportunity', 'update_opportunity', 'prepare_draft', 'update_draft', 'capture', 'review', 'import_legacy'])
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/
function fail(code, message = code) { const e = new Error(message); e.code = code; throw e }

/** Reject encrypted, explicitly restricted, or detector-classified data at cloud boundaries. */
export function corpExternalSafe(raw) {
  if (typeof raw !== 'string' || /^(?:KMS1|KEEPMIND-ITEM:1)\r?\n/.test(raw)) return false
  const header = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || ''
  if (/^(?:class|class_override):[ \t]*(?:sensitive|secret)\s*$/im.test(header)) return false
  const scan = scanText('crm', raw)
  return !scan.encrypted && !scan.skipped && !scan.secrets.length && !scan.pii.length
}

/** Build paths exclusively from the authenticated user's current organization membership. */
export function corpCrm(vault, org, user, board = 'personal') {
  user = user && org.users.find(u => u.id === user.id && !u.disabled)
  if (!user) fail('forbidden')
  if (!SAFE_ID.test(user.id) || !SAFE_ID.test(user.teamId) || !org.teams.some(t => t.id === user.teamId)) fail('forbidden')
  if (board !== 'personal' && board !== 'team') fail('bad_board')
  const root = board === 'team' ? `shared/crm/teams/${user.teamId}` : `people/${user.id}/memory`
  const canWrite = ['owner', 'admin', 'member'].includes(user.role)
  const storageScope = createHash('sha256').update(`${org.crmNamespace || ''}:${user.id}:${board}:${user.teamId}`).digest('hex')
  const canConfigure = canWrite && (board === 'personal' || ['owner', 'admin'].includes(user.role))
  const capabilities = { storageScope, boards: [{ id: 'personal', label: 'Pessoal' }, { id: 'team', label: 'Equipe' }], activeBoard: board, canWrite, canSend: false, sendChannels: [], canAutomate: canWrite, canConfigure }
  const scoped = rel => {
    if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\') || rel.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) fail('bad_path')
    return `${root}/${rel}`
  }
  const checked = rel => {
    if (typeof rel !== 'string' || !(rel.startsWith(`${root}/`))) fail('bad_path')
    assertNoSymlinkPath(vault, rel)
    return path.join(vault, rel)
  }
  const classes = ['public', 'internal', 'sensitive', 'secret']
  let classificationFloor = 'internal'
  const raiseFloor = raw => {
    if (/^(?:KMS1|KEEPMIND-ITEM:1)\r?\n/.test(raw)) fail('EVIDENCE_UNAVAILABLE')
    const header = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || ''
    for (const match of header.matchAll(/^(?:class|class_override):[ \t]*(public|internal|sensitive|secret)\s*$/gim)) {
      const value = match[1].toLowerCase()
      if (classes.indexOf(value) > classes.indexOf(classificationFloor)) classificationFloor = value
    }
    const scan = scanText('crm', raw)
    const detected = scan.secrets.length ? 'secret' : scan.pii.length ? 'sensitive' : 'internal'
    if (classes.indexOf(detected) > classes.indexOf(classificationFloor)) classificationFloor = detected
  }
  const adapter = {
    scopePath: scoped,
    space: () => board,
    assertEvidencePath: rel => { checked(rel) },
    read: rel => { const file = checked(rel); if (!existsSync(file)) return null; const raw = readFileSync(file, 'utf8'); raiseFloor(raw); return raw },
    list: rel => { const dir = checked(rel); return existsSync(dir) ? readdirSync(dir) : [] },
    write: (rel, content) => {
      const file = checked(rel)
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
      checked(rel)
      const tmp = `${file}.${randomBytes(12).toString('hex')}.tmp`
      raiseFloor(content)
      const protectedContent = content.replace(/^(class:[ \t]*)(public|internal|sensitive|secret)([ \t]*)$/m, (line, prefix, value, suffix) => classes.indexOf(value) < classes.indexOf(classificationFloor) ? `${prefix}${classificationFloor}${suffix}` : line)
      try { writeFileSync(tmp, protectedContent, { flag: 'wx', mode: 0o600 }); renameSync(tmp, file) } finally { try { unlinkSync(tmp) } catch {} }
    },
    withLock: (rel, fn) => { const file = checked(rel); mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); checked(rel); return withProjectLock(file, fn) }
  }
  const service = new CrmService(adapter)
  return {
    capabilities,
    externalModelAllowed: () => { const raw = adapter.read(scoped('crm/relationships.md')); return raw === null || corpExternalSafe(raw) },
    exists: () => existsSync(checked(scoped('crm/relationships.md'))),
    dispatch(action, args = {}, actor = 'human') {
      if (!['human', 'agent', 'connector'].includes(actor)) fail('forbidden')
      if (action !== 'snapshot' && action !== 'context' && !MUTATIONS.has(action)) fail('bad_action')
      if (actor !== 'human' && !AGENT_ACTIONS.has(action)) fail('forbidden')
      if (MUTATIONS.has(action) && !canWrite) fail('forbidden')
      if (action === 'settings' && !canConfigure) fail('forbidden')
      if (!args || typeof args !== 'object' || Array.isArray(args)) fail('bad_request')
      const { board: ignored, actor: ignoredActor, ...safeArgs } = args
      classificationFloor = 'internal'
      const result = service.dispatch(action, safeArgs, actor)
      return action === 'context' ? result : { ...result, capabilities }
    }
  }
}

export async function extractCorpCapture(vault, org, user, text, persistOrg, options = {}) {
  const key = org.policy?.providers?.includes('openai') ? getLlmSecret(vault, 'openai', user) : null
  const team = org.teams.find(t => t.id === user.teamId)
  const complete = key && team && options.externalAllowed !== false && corpExternalSafe(text) ? async ({ system, user: prompt }) => {
    assertTeamBudget(org, user.teamId)
    const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: 600 }) })
    if (!response.ok) throw Error('extraction_unavailable')
    const data = await response.json()
    const result = data.choices?.[0]?.message?.content
    recordTeamUsage(team, UNIT_CHAT_CLOUD)
    recordByokUsage(vault, { provider: 'openai', promptChars: system.length + prompt.length, completionChars: String(result || '').length })
    persistOrg?.()
    return result
  } : undefined
  return extractCrmCapture(text, { complete, timeZone: options.timeZone })
}

export function mountCrmApi({ vault, getOrg, audit, persistOrg }) {
  return async (req, res, url, user, syncCtx) => {
    if (url.pathname !== '/api/crm') return false
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); return true }
    if (syncCtx) return send(403, { error: 'forbidden' })
    try {
      if (req.method === 'GET') return send(200, corpCrm(vault, getOrg(), user, url.searchParams.get('board') || 'personal').dispatch('snapshot'))
      if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' })
      const chunks = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 65536) fail('bad_request'); chunks.push(chunk) }
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('bad_request') }
      if (!body || typeof body !== 'object' || typeof body.action !== 'string') fail('bad_request')
      const args = body.args || {}
      const crm = corpCrm(vault, getOrg(), user, args.board || 'personal')
      if (body.action === 'capture') {
        if (!crm.capabilities.canWrite) fail('forbidden')
        args.extraction = (await extractCorpCapture(vault, getOrg(), user, args.text, persistOrg, { timeZone: args.timeZone, externalAllowed: crm.externalModelAllowed() })).extraction
      }
      const result = crm.dispatch(body.action, args, 'human')
      if (MUTATIONS.has(body.action)) audit(user, 'crm_action', { action: body.action, board: crm.capabilities.activeBoard })
      return send(200, result)
    } catch (error) {
      const code = error.code || error.message || 'crm_error'
      const status = code === 'forbidden' ? 403 : /CONFLICT|LOCKED|REVISION/i.test(code) ? 409 : 400
      return send(status, { error: code, message: code })
    }
  }
}

/** Revisit only existing boards, never creating empty personal records. */
export function startCrmScheduler(vault, getOrg, interval = 15 * 60 * 1000) {
  const sweep = () => {
    const org = getOrg(); const teams = new Set()
    for (const user of org.users.filter(u => !u.disabled && u.role !== 'auditor')) {
      for (const board of ['personal', 'team']) {
        if (board === 'team' && teams.has(user.teamId)) continue
        if (board === 'team') teams.add(user.teamId)
        try {
          const crm = corpCrm(vault, org, user, board)
          if (!crm.exists()) continue
          const snapshot = crm.dispatch('snapshot', {}, 'agent')
          if (snapshot.settings?.autoPrepare) crm.dispatch('review', { expectedRevision: snapshot.revision }, 'agent')
        } catch (e) { console.error('CRM scheduled review failed:', e.code || e.message) }
      }
    }
  }
  queueMicrotask(sweep)
  const timer = setInterval(sweep, interval); timer.unref?.()
  return () => clearInterval(timer)
}
