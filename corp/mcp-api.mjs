import { readFileSync } from 'node:fs'
import { invokeCorpMcpTool, MCP_TOOLS } from './mcp-runtime.mjs'
import { assertAgentQuota, recordAgentUsage } from './agent-usage.mjs'
import { assertTeamBudget, recordTeamUsage, UNIT_MCP } from './team-usage.mjs'

export function mountMcpApi({ vault, getOrg, audit, persistOrg, memoryFilesForUser }) {
  return async function mcpApi(req, res, url, user, syncCtx) {
    if (!url.pathname.startsWith('/api/mcp/')) return false
    const sub = url.pathname.slice('/api/mcp/'.length)
    const org = getOrg()

    if (sub === 'tools' && req.method === 'GET') {
      return json(res, 200, { tools: MCP_TOOLS })
    }

    if (sub === 'call' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const tool = String(body.tool || body.name || '').trim()
      // Per-tool scope: writes need mcp:invoke; reads accept mcp:read too.
      const isWrite = !['sb_search', 'sb_read', 'sb_list', 'crm_snapshot', 'crm_context'].includes(tool)
      const scopes = syncCtx?.scopes || []
      const allowed = isWrite ? scopes.includes('mcp:invoke') : (scopes.includes('mcp:invoke') || scopes.includes('mcp:read'))
      if (syncCtx && !allowed) {
        return json(res, 403, { error: 'forbidden', message: isWrite ? 'Token sem escopo mcp:invoke (escrita).' : 'Token sem escopo mcp:read/mcp:invoke.' })
      }
      const agentId = String(body.agentId || 'composer').trim()
      const args = body.arguments ?? body.args ?? {}
      const composerOn = org.agents.find((a) => a.id === 'composer' && a.enabled)
      const brainOn = org.agents.find((a) => a.id === 'brain' && a.enabled)
      if (agentId === 'composer' && !composerOn) {
        return json(res, 403, { error: 'agent_off', message: 'Ative o agente Composer.' })
      }
      if (agentId === 'brain' && !brainOn) {
        return json(res, 403, { error: 'agent_off', message: 'Ative o agente Brain.' })
      }
      try {
        assertTeamBudget(org, user.teamId)
        const agent = assertAgentQuota(org, agentId)
        if (agent.teamId && agent.teamId !== 'everyone' && agent.teamId !== user.teamId) { const e = new Error('Agent is not available to this team'); e.code = 'forbidden'; throw e }
        const files = memoryFilesForUser(vault, user, org)
        const text = await invokeCorpMcpTool({
          vault,
          org,
          user,
          agentId,
          tool,
          args,
          memoryFiles: files,
          readAbs: (abs) => readFileSync(abs, 'utf8')
        })
        recordAgentUsage(agent)
        const team = org.teams.find((t) => t.id === user.teamId) ?? org.teams[0]
        recordTeamUsage(team, UNIT_MCP)
        persistOrg()
        audit(user, 'mcp_tool', { agentId, tool, tokenId: syncCtx?.tokenId })
        return json(res, 200, { ok: true, tool, text })
      } catch (e) {
        const code = e.code || 'mcp_error'
        const status = code === 'secret_blocked' ? 400 : code === 'quota_exceeded' || code === 'team_budget_exceeded' ? 429 : 400
        return json(res, status, { ok: false, error: code, message: e.message })
      }
    }

    return json(res, 404, { error: 'not_found' })
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
  return true
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 65536) reject(new Error('too large'))
      else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('bad json'))
      }
    })
    req.on('error', reject)
  })
}
