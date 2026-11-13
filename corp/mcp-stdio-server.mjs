import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { MCP_TOOLS, invokeCorpMcpTool } from './mcp-runtime.mjs'
import { assertAgentQuota, recordAgentUsage } from './agent-usage.mjs'
import { assertTeamBudget, recordTeamUsage, UNIT_MCP } from './team-usage.mjs'
import { listCorpMemoryFiles } from './brain-api.mjs'

const PROTOCOL_VERSION = '2024-11-05'

function toolSchemas() {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema || { type: 'object', properties: {}, additionalProperties: true }
  }))
}

export function runStdioMcpServer({
  vault,
  getOrg,
  getUser,
  agentId = 'composer',
  persistOrg,
  audit = () => {}
}) {
  function ok(id, result) {
    return { jsonrpc: '2.0', id, result }
  }
  function err(id, code, message) {
    return { jsonrpc: '2.0', id, error: { code, message } }
  }

  async function handleCall(name, args) {
    const org = getOrg()
    const user = getUser()
    if (!user) throw new Error('No user bound to token')
    assertTeamBudget(org, user.teamId)
    const agent = assertAgentQuota(org, agentId)
        if (agent.teamId && agent.teamId !== 'everyone' && agent.teamId !== user.teamId) { const e = new Error('Agent is not available to this team'); e.code = 'forbidden'; throw e }
    const files = listCorpMemoryFiles(vault, user, org)
    const text = await invokeCorpMcpTool({
      vault,
      org,
      user,
      agentId,
      tool: name,
      args,
      memoryFiles: files,
      readAbs: (abs) => readFileSync(abs, 'utf8')
    })
    recordAgentUsage(agent)
    const team = org.teams.find((t) => t.id === user.teamId) ?? org.teams[0]
    recordTeamUsage(team, UNIT_MCP)
    persistOrg?.()
    audit(user, 'mcp_tool_stdio', { agentId, tool: name })
    return text
  }

  function handle(msg) {
    const { id, method, params } = msg
    if (id === undefined) return null
    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'keepmind-corp', version: '0.6.0' }
      })
    }
    if (method === 'ping') return ok(id, {})
    if (method === 'tools/list') return ok(id, { tools: toolSchemas() })
    if (method === 'tools/call') {
      return handleCall(params?.name, params?.arguments ?? {})
        .then((text) => ok(id, { content: [{ type: 'text', text: String(text) }] }))
        .catch((e) => ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true }))
    }
    return err(id, -32601, `method not found: ${method}`)
  }

  const rl = createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try {
      msg = JSON.parse(trimmed)
    } catch {
      return
    }
    const out = handle(msg)
    Promise.resolve(out).then((res) => {
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`)
    })
  })
  process.stderr.write('[keepmind-corp-mcp] stdio worker (in-process vault)\n')
}
