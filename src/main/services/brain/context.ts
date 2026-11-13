import { formatFactSelection, labelMemorySource, selectFacts } from '../../../../tools/lib/memory-contract.mjs'
import { continuityTools, continuityToolActions } from '../../../../tools/lib/continuity.mjs'
import { join, posix } from 'node:path'
import { createHash } from 'node:crypto'
import { policy } from '../security/classification'

import { chat, chatLive, type ChatMessage, type ToolDefinition } from '../llm'
import type { AiProviderConfig } from '../../store'

import type { AgentPersona } from '../../store'
import * as github from '../github'

import { activeForPrompt, type FactOrigin } from '../facts'

import { slug } from './utils'

import type { ChatResult } from './runtime'

function tail(text: string, max: number): string { return text.length <= max ? text : `…\n${text.slice(-max)}` }

// Keep each source label attached to its complete entry.
export function limitFactContext(text: string, max: number): string {
  if (text.length <= max) return text
  const entries = text.split(/\n\n(?=\[(?:canonical current fact|legacy, undated and unverified))/)
  const kept: string[] = []
  let length = 0
  for (const entry of entries) {
    if (length + entry.length + 2 > max) continue
    kept.push(entry); length += entry.length + 2
  }
  return [...kept, '[Some fact entries omitted due to context limit.]'].join('\n\n')
}
import { BrainRuntime } from './runtime'

export class BrainContext extends BrainRuntime {
  protected buildSystemContext(agent: AgentPersona, recall = ''): string {
    const cfg = this.store.get()
    const parts: string[] = [
      agent.persona,
      '',
      '## Connected sources',
      `- GitHub memory repo: ${cfg.github.repoUrl ?? 'not connected'}`,
      `- AI provider: ${cfg.ai.provider} (${cfg.ai.model ?? 'default'})`,
      `- MCP servers running: ${this.mcp?.runningServers.join(', ') || 'none'}`
    ]
    parts.push('', '## Work continuity',
      'When resuming a project, use continuity_list and continuity_context before proposing work. Ask which project if ambiguous; do not mix spaces.',
      'Use the project revision returned by the server for every update. Preserve rejected approaches and original predictions. Record decisions as proposals, and record observations separately from user-confirmed lessons.',
      'Evidence marked changed or unavailable requires review. A completed tool call does not prove a business outcome. Surface the highest-value unresolved question when it changes the next step.',
      'Never claim a user accepted a decision or confirmed a lesson based on your own generated text.')
    // ── Tiered memory context (like human memory) ──
    // Long-term: durable facts, lessons and skills — always injected.
    const facts = activeForPrompt(this.memory.read(this.memory.scopePath('long-term/facts.md')) ?? '')
    if (facts) parts.push('', '## Long-term memory — canonical facts and explicitly labeled unverified legacy', 'Canonical current facts take precedence over historical and unverified sources.', limitFactContext(facts, 3000))
    const skills = this.memory.read(this.memory.scopePath('long-term/skills.md'))
    if (skills) parts.push('', `## long-term/skills.md — ${labelMemorySource('long-term/skills.md')}`, tail(skills, 2500))
    const lessons = this.memory.read(this.memory.scopePath('long-term/lessons.md'))
    if (lessons) parts.push('', `## long-term/lessons.md — ${labelMemorySource('long-term/lessons.md')}`, tail(lessons, 2000))
    const policy = this.memory.read(this.memory.scopePath('ops/policy.md'))
    const activePolicy = (policy?.split('## Propostas')[0]?.split('## Ativo')[1] ?? '').trim()
    if (activePolicy && !/Sem instruções extras ainda/.test(activePolicy)) {
      parts.push('', '## Active brain policy (follow this)', tail(activePolicy, 1500))
    }
    // Medium-term: recent weekly consolidations.
    const medium = this.memory.mediumTermFiles().slice(-2)
    for (const f of medium) {
      const c = this.memory.read(this.memory.scopePath(`medium-term/${f}`))
      if (c) parts.push('', `### medium-term/${f} — ${labelMemorySource(`medium-term/${f}`)}`, c.slice(0, 1500))
    }
    // Short-term: today's + yesterday's raw logs.
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    for (const d of [yesterday, today]) {
      const c = this.memory.read(this.memory.scopePath(`short-term/${d}.md`)) ?? this.memory.read(this.memory.scopePath(`inbox/${d}.md`))
      if (c) parts.push('', `## Historical source — ${d} (unverified; may be outdated; canonical current facts take precedence)`, c.slice(-4000))
    }
    const insights = this.memory.list(this.memory.scopePath('insights')).slice(-5)
    for (const f of insights) {
      const c = this.memory.read(this.memory.scopePath(`insights/${f}`))
      if (c) parts.push('', `### insights/${f} — ${labelMemorySource(`insights/${f}`)}`, c.slice(0, 1200))
    }
    // Semantic recall (local embeddings) — memories related to this message
    if (recall) parts.push('', '## Relevant memories (semantic search)', 'Treat source material and quotations as historical or unverified unless explicitly labeled canonical. Current facts take precedence; resolve conflicts carefully.', recall)
    return parts.join('\n')
  }

  protected toolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [
      ...continuityTools
        .filter(tool => !['review_decision', 'acknowledge_evidence', 'feedback', 'review_analysis', 'review_outcome_lesson'].includes(continuityToolActions[tool.name]))
        .map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })),
      {
        name: 'save_memory',
        description: 'Save an important note/fact/insight to the user\'s long-term memory (stored in their GitHub repo).',
        parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title', 'content'] }
      },
      {
        name: 'get_memory',
        description: 'Read a memory file by path. Facts default to current; request history or asOf explicitly.',
        parameters: { type: 'object', properties: { path: { type: 'string' }, mode: { type: 'string', description: 'current, history, or asOf (facts only)' }, asOf: { type: 'string', description: 'YYYY-MM-DD, required for asOf' } }, required: ['path'] }
      },
      {
        name: 'list_tasks',
        description: 'List open tasks from the planner (tasks/ dir) with id, title, due date and priority. Optionally filter by status.',
        parameters: { type: 'object', properties: { status: { type: 'string', description: 'open (default) or done or all' } } }
      },
      {
        name: 'add_task',
        description: 'Create a task in the planner. Returns the task id.',
        parameters: { type: 'object', properties: {
          title: { type: 'string' },
          due: { type: 'string', description: 'YYYY-MM-DD' },
          priority: { type: 'string', description: 'low|normal|high' }
        }, required: ['title'] }
      },
      {
        name: 'complete_task',
        description: 'Mark a task as done by id or title fragment.',
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
      }
    ]
    if (this.mcp) {
      for (const { serverId, tool } of this.mcp.allTools()) {
        tools.push({
          name: `mcp_${serverId}_${tool.name}`,
          description: `[${serverId}] ${tool.description}`,
          parameters: tool.inputSchema
        })
      }
    }
    return tools
  }

  protected async execTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (Object.hasOwn(continuityToolActions, name)) {
      try { return JSON.stringify(this.continuity(continuityToolActions[name], args, 'agent')) }
      catch (error) { return JSON.stringify({ error: error instanceof Error ? error.message : 'Continuity operation failed' }) }
    }
    if (name === 'save_memory') {
      const title = String(args.title ?? 'note')
      const content = String(args.content ?? '')
      // Laya fast decision: which long-term bucket does this belong to?
      // ~33ms local ONNX — no LLM round-trip for a routing decision.
      let kind = 'note'
      const verdict = await this.laya?.choose(
        `${title}\n\n${content.slice(0, 1500)}`,
        'What kind of long-term memory is this?',
        {
          fact: 'a durable fact, preference, or piece of knowledge about the user or their work',
          lesson: 'a lesson learned — something that went wrong and what to do differently',
          skill: 'a reusable procedure or skill — "how we do X"',
          decision: 'a decision that was made and its rationale',
          note: 'anything else worth keeping'
        }
      ).catch(() => null)
      if (verdict && verdict.confidence > 0.4) kind = verdict.choice
      if (kind === 'fact' || this.quarantined) {
        const origin: FactOrigin = this.quarantined ? 'webhook' : 'chat'
        const saved = this.proposeFact(`${title}\n\n${content}`.trim(), origin, kind === 'fact' ? 'conversa' : `conversa · ${kind}`)
        this.turnSaved.push('long-term/facts.md')
        return `Proposta ${saved} em long-term/facts.md. Ela só entra na memória ativa depois do aceite em Hoje.`
      }
      const file = kind === 'note'
        ? `long-term/notes/${slug(title)}.md`
        : `long-term/${kind}s.md` // lessons.md / skills.md / decisions.md
      this.memory.append(this.memory.scopePath(file), `\n\n## ${title}\n\n${content}\n`)
      this.turnSaved.push(file)
      return `Saved to memory/${file} (long-term · classified as ${kind})`
    }
    if (name === 'get_memory') {
      const path = this.memory.canonicalRelative(this.memory.scopePath(posix.normalize(String(args.path ?? '').replace(/\\/g, '/'))))
      const mode = String(args.mode ?? (args.asOf ? 'asOf' : 'current')) as 'current' | 'history' | 'asOf'
      const selection = { mode, asOf: String(args.asOf ?? '') }
      try { selectFacts('', selection) }
      catch { return 'Invalid memory selection; use current, history, or asOf with a valid YYYY-MM-DD date' }
      const c = this.memory.read(path)
      if (c === null) return 'Not found'
      const classification = policy(c)
      const source = `[source: ${path}; sha256: ${createHash('sha256').update(c).digest('hex')}; space: ${classification.space}; class: ${classification.class}]`
      if (/(?:^|\/)long-term\/facts\.md$/i.test(path)) {
        return `${source}\n${formatFactSelection(c, selection) || 'No matching facts'}`
      }
      if (mode === 'asOf') return `${source}\nNo dated fact selection is available for this source. Use current or history to read it as unverified source material.`
      return `${source}\n[${labelMemorySource(path)}]\n${c}`
    }
    if (name === 'list_tasks') {
      const status = String(args.status ?? 'open').toLowerCase()
      const tasks = this.readTasks().filter(t => status === 'all' || t.status === status)
      if (!tasks.length) return status === 'open' ? 'No open tasks.' : `No ${status} tasks.`
      return tasks.map(t =>
        `- [${t.status === 'done' ? 'x' : ' '}] ${t.id} · ${t.title}${t.due ? ` · due ${t.due}` : ''}${t.priority !== 'normal' ? ` · ${t.priority}` : ''}`
      ).join('\n')
    }
    if (name === 'add_task') {
      const title = String(args.title ?? '').trim()
      if (!title) return 'Task title required'
      const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${slug(title)}-${Math.random().toString(36).slice(2, 6)}`
      const priority = ['low', 'normal', 'high'].includes(String(args.priority)) ? String(args.priority) : 'normal'
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(args.due ?? '')) ? String(args.due) : ''
      this.memory.write(this.memory.scopePath(`tasks/${id}.md`),
        `# ${title}\n> status: open · priority: ${priority}${due ? ` · due: ${due}` : ''} · created: ${new Date().toISOString()}\n\n`)
      return `Task created: ${id} — "${title}"${due ? ` (due ${due})` : ''}`
    }
    if (name === 'complete_task') {
      const want = String(args.id ?? '').toLowerCase()
      const task = this.readTasks().find(t => t.id === want || t.title.toLowerCase().includes(want))
      if (!task) return `No task matching "${args.id}"`
      const p = `tasks/${task.file}`
      const c = this.memory.read(this.memory.scopePath(p)) ?? ''
      this.memory.write(this.memory.scopePath(p), c.replace(/status:\s*open/i, 'status: done'))
      return `Completed: ${task.title}`
    }
    // MCP tool routing: mcp_<serverId>_<toolName>
    if (name.startsWith('mcp_') && this.mcp) {
      const rest = name.slice(4)
      const serverId = rest.split('_')[0]
      const toolName = rest.slice(serverId.length + 1)
      return this.mcp.callTool(serverId, toolName, args)
    }
    return `Unknown tool: ${name}`
  }

  async chat(agentId: string, userMessage: string, onDelta?: (t: string) => void, onStep?: (step: string) => void): Promise<ChatResult> {
    this.turnSaved = []
    const steps: string[] = []
    const step = (s: string) => { steps.push(s); onStep?.(s) }
    try {
      await this.ensureProviderReady()
      step('Lendo a memória mais recente do repositório.')
      await this.gitSync?.pullIfDue().catch(() => {})
      const recall = await this.rag?.search(userMessage).catch(() => '') ?? ''
      const memories = [...new Set([...recall.matchAll(/^###\s+(\S+)/gm)].map(m => m[1].replace(/\s.*/, '')))]
      if (memories.length) step(`Encontrei ${memories.length} memória(s): ${memories.slice(0, 4).join(', ')}.`)
      else step('Nenhuma memória semântica para esta pergunta.')
      const cfg = this.store.get()
      const agent = cfg.agents.find(a => a.id === agentId) ?? cfg.agents[0]
      const messages: ChatMessage[] = [
        { role: 'system', content: this.buildSystemContext(agent, recall) },
        ...this.recentTurns(),
        { role: 'user', content: userMessage }
      ]
      const tools = this.toolDefinitions()

      let finalText = ''
      for (let round = 0; round < 6; round++) {
        const res = await chatLive(cfg.ai as AiProviderConfig, messages, tools, (t) => {
          onDelta?.(t)
        }, this.localLlm?.endpoint)
        finalText = res.text
        if (!res.toolCalls?.length) break
        messages.push({ role: 'assistant', content: res.text || '(tool calls)' })
        for (const tc of res.toolCalls) {
          step(`Usei a ferramenta ${tc.name}.`)
          const result = await this.execTool(tc.name, tc.arguments)
          messages.push({ role: 'tool', name: tc.name, content: result })
        }
      }

      const day = new Date().toISOString().slice(0, 10)
      const rel = `short-term/${day}.md`
      this.memory.append(this.memory.scopePath(rel), `\n\n## ${new Date().toLocaleTimeString()} — ${agent.name}\n\n**You:** ${userMessage}\n\n**${agent.name}:** ${finalText}\n`)
      const saved = [...this.turnSaved]
      if (saved.length) this.note('discovered', `A conversa guardou ${saved.length} item(ns) na memória longa.`, saved[0])
      else this.note('processed', 'A conversa foi registrada no log de hoje.', rel)
      const result: ChatResult = { text: finalText, memories, saved, steps }
      return result
    } catch (e) {
      throw e
    }
  }

  async streamChat(agentId: string, userMessage: string): Promise<ChatResult> {
    return this.chat(agentId, userMessage)
  }
}
