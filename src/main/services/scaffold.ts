import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import type { AppConfig, GitHubConfig } from '../store'
import * as github from './github'

// ── Repo scaffold: files that teach ANY agent how to use this memory repo ──
//
// Pushed once to the user's GitHub repo (repo root, outside memory/):
//   AGENTS.md              — layout + conventions + MCP tools (read by Codex,
//                            Claude Code, Cursor, Gemini CLI, OpenCode…)
//   CLAUDE.md              — @AGENTS.md import for Claude Code
//   GEMINI.md              — pointer for Gemini CLI
//   .mcp.json              — registers the bundled memory MCP server
//   tools/keepmind-mcp.mjs — zero-dep MCP server shipped IN the repo,
//                            so `git clone` + `node tools/...` is all a bot needs

const AGENTS_MD = `# KeepMind — agent guide

This repository is a **KeepMind memory store**. Everything under \`memory/\`
is durable knowledge written and read by AI agents. Treat it as the user's
long-term memory: read before answering, write what matters.

## Layout (memory/)

| Path | Contents |
|---|---|
| \`short-term/\` | daily raw logs — recent working memory |
| \`medium-term/\` | weekly consolidations |
| \`long-term/\` | \`facts.md\`, \`lessons.md\`, \`skills.md\`, \`notes/\` — permanent memory |
| \`sleep/\` | nightly learning reports |
| \`insights/\`, \`summaries/\` | generated insights & daily summaries |
| \`notes/\` | user notes (Markdown) |
| \`tasks/\` | to-dos — \`# Title\` + \`> status: open · priority: … · due: …\` meta line |
| \`daily/\` | daily intentions/goals |
| \`meetings/\` | legacy roundtable transcripts |
| \`entities/\` | one page per person/project/topic, linked with \`[[Name]]\` |
| \`review/\` | spaced-repetition flashcards (\`cards.md\`) + quiz sessions |
| \`skills/\` | procedural skills — one Markdown page per reusable procedure |
| \`crm/\` | \`people/\`, \`companies/\`, \`interactions/\` — relationship memory |
| \`ops/\` | operational logs — \`search-gaps.md\` records unanswered queries |
| \`long-term/decisions.md\` | decision ledger — \`sb_remember kind=decision\` vira proposta em \`long-term/facts.md\` |
| \`projects/\` | versioned project state, decisions, attempts, evidence and outcomes; use continuity tools to change it |

## MCP server (recommended)

This repo ships its own memory server — zero dependencies, Node 18+:

\`\`\`bash
node tools/keepmind-mcp.mjs --dir ./memory
\`\`\`

Tools: \`sb_search\` (search memory first!), \`sb_read\`, \`sb_write\`,
\`sb_append\`, \`sb_remember\` (proposta de fato, lição, skill ou decisão), \`sb_supersede\`, \`sb_recent\`,
\`sb_list\`, \`sb_tree\`, \`sb_tasks\`, \`sb_query\` (structured filters:
tasks by status/priority/due, notes by tag, entities by text).

For work across assistants: use \`continuity_list\`, then \`continuity_context\`.
The returned project revision and evidence fingerprint identify the context you
received. Use \`continuity_create\`, \`continuity_add_decision\`,
\`continuity_add_attempt\`, \`continuity_record_outcome\` and the other continuity
tools to record progress. Every update requires \`expectedRevision\`; on a
conflict, read the current project and reconcile before trying again. Decisions
remain proposals until a person reviews them. A completed tool call is not proof
of a business outcome. Preserve rejected approaches and original expectations.
Changed/unavailable sources require review. Never overwrite project files with
generic note tools. Fact reads/search default to current facts; request
\`mode: "history"\` or \`mode: "asOf", asOf: "YYYY-MM-DD"\` explicitly for history.

Claude Code picks it up automatically via \`.mcp.json\`. **Cursor Composer**
(Agent mode) uses \`.cursor/mcp.json\` + \`.cursor/rules/keepmind-memory.mdc\`.
Codex, Gemini CLI, OpenCode or any MCP client can spawn the same command.

## Conventions

- Markdown only. One fact per bullet in \`long-term/\` files.
- Tasks: first line \`# Title\`, second line \`> status: open|done · priority: low|normal|high · due: YYYY-MM-DD · created: ISO\`.
- Notes may carry YAML frontmatter (\`summary:\`, \`tags:\`, \`links:\`, \`enriched:\`) — preserve it when editing.
- Classify sensitivity in frontmatter: \`sensitivity: public|internal|sensitive|secret\`. The app masks secret-shaped values (API keys, tokens, private keys, password assignments) before any content reaches a cloud LLM — local models see everything. Use \`secret\` for credentials, financial or board-confidential material.
- Notes may also declare freshness: \`valido_ate: YYYY-MM-DD\` (or \`expires:\`) — expired notes are demoted in search. Set \`review_after:\` for time-sensitive content.
- Distinguish hypothesis from fact: prefix unverified claims with \`> proof: hypothesis\`; confirmed ones with \`> proof: confirmed\`.
- Link recurring people/projects/topics with \`[[Name]]\` — entity pages live in \`memory/entities/\`.
- Write in the user's language. Keep entries dated and concise.
- Prefer \`sb_remember\` for durable facts. The person accepts the proposal in Hoje before it becomes active.
`

const mcpJsonFor = (dirArg: string) => JSON.stringify({
  mcpServers: {
    'keepmind': {
      command: 'node',
      args: ['tools/keepmind-mcp.mjs', '--dir', dirArg]
    }
  }
}, null, 2) + '\n'

// Cursor reads .cursor/mcp.json; Gemini CLI reads .gemini/settings.json —
// same mcpServers shape, so agents in those tools connect with zero config.
const GEMINI_NOTE = 'Read AGENTS.md — it documents this KeepMind memory repo, its conventions, and the bundled MCP server (tools/keepmind-mcp.mjs).\n'

const COMPOSER_RULE = `---
description: KeepMind memory — search before answering, append after work (Composer)
globs:
alwaysApply: true
---

You have the **keepmind** MCP server (sb_search, sb_read, sb_append, sb_remember, …).

1. Before answering about the user, their work, or prior decisions: run **sb_search**.
2. After meaningful work: **sb_append** or **sb_remember** — never rewrite history.
3. Follow repo **AGENTS.md** if present; it overrides generic layout guesses.
4. Never store secrets or credentials in memory.
`

function mcpBundleSources(): Array<[string, string]> {
  // tools/keepmind-mcp.mjs ships inside the app bundle (and the repo)
  const candidates = [
    join(__dirname, '../../tools/keepmind-mcp.mjs'),
    join(__dirname, '../../../tools/keepmind-mcp.mjs'),
    join(process.cwd(), 'tools/keepmind-mcp.mjs')
  ]
  for (const p of candidates) {
    try {
      const modules: Array<[string, string]> = ['lib/memory-contract.mjs', 'lib/continuity.mjs'].map(rel => [rel, readFileSync(join(dirname(p), rel), 'utf8')])
      // Materialize imports before the entry point is replaced.
      return [...modules, ['keepmind-mcp.mjs', readFileSync(p, 'utf8')]]
    } catch { /* try next complete bundle */ }
  }
  throw new Error('Complete KeepMind MCP bundle not found')
}

// Materialize the zero-dep MCP server on disk so EXTERNAL agents/CLIs
// (Codex, Claude Code, Cursor, bots on a VPS…) can spawn it — files inside
// app.asar are not executable by a plain `node` process.
export function ensureMcpServerScript(): string {
  const dir = join(app.getPath('userData'), 'mcp')
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, 'keepmind-mcp.mjs')
  for (const [rel, content] of mcpBundleSources()) {
    const target = join(dir, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(`${target}.tmp`, content, 'utf8')
    renameSync(`${target}.tmp`, target)
  }
  return dest
}

export async function ensureRepoScaffold(gh: GitHubConfig): Promise<string[]> {
  if (!gh.accessToken || !gh.repoOwner) return []
  const [root, tools, modules] = await Promise.all([
    github.listRepoFiles(gh, ''),
    github.listRepoFiles(gh, 'tools'),
    github.listRepoFiles(gh, 'tools/lib')
  ])
  // Whole-vault imports (syncRoot '') mirror the repo root — the MCP server
  // must point there, not at a memory/ subdir that doesn't exist.
  const memArg = gh.syncRoot === '' ? '.' : `./${(gh.syncRoot ?? 'memory/').replace(/\/$/, '')}`
  const mcpJson = mcpJsonFor(memArg)
  // Imported vaults (syncRoot '') have their own governance docs — never
  // overwrite/impose the native memory/ layout guide on them.
  const nativeDocs: Array<[string, string]> = gh.syncRoot === '' ? [] : [
    ['AGENTS.md', AGENTS_MD],
    ['CLAUDE.md', '@AGENTS.md\n'],
    ['GEMINI.md', GEMINI_NOTE],
  ]
  const files: Array<[string, string]> = [
    ...nativeDocs,
    ['.mcp.json', mcpJson],
    ['.cursor/mcp.json', mcpJson],
    ['.cursor/rules/keepmind-memory.mdc', COMPOSER_RULE],
    ['.gemini/settings.json', mcpJson],
    ...mcpBundleSources().map(([rel, content]): [string, string] => [`tools/${rel}`, content])
  ]

  const pushed: string[] = []
  for (const [path, content] of files) {
    const base = path.split('/').pop()!
    const inTools = path.startsWith('tools/')
    const directory = path.startsWith('tools/lib/') ? modules : inTools ? tools : root
    const exists = directory.includes(path) || directory.includes(base)
    if (exists) continue
    await github.pushMetadataFile(gh, path, content, 'scaffold: agent onboarding files')
    pushed.push(path)
  }
  return pushed
}

// ── keepmind.json: "brain as code" ──
// A sanitized declaration of the brain — agents, automations, connectors,
// model prefs — at the repo ROOT (outside memory/). Any bot or agent that
// clones the repo can see how the brain is configured. NEVER includes
// secrets: no API keys, tokens, env values or webhook tokens.

export function brainConfigJson(cfg: AppConfig): string {
  const memoryRoot = cfg.github.syncRoot ?? 'memory/'
  const doc = {
    $schema: 'keepmind/v1',
    generatedAt: new Date().toISOString(),
    memoryRoot: memoryRoot === '' ? '.' : memoryRoot,
    note: 'Declarative snapshot of this KeepMind brain. Secrets are never included. Repo governance docs (AGENTS.md, governance/) define the actual memory layout — this file only mirrors the sync root.',
    ai: { provider: cfg.ai.provider, model: cfg.ai.model ?? null, localModel: cfg.localLlm.modelId ?? null },
    agents: cfg.agents.map(a => ({ id: a.id, name: a.name, emoji: a.emoji, builtin: !!a.builtin })),
    automations: cfg.automations.map(a => ({
      id: a.id, name: a.name, kind: a.kind, schedule: a.schedule,
      time: a.time ?? null, everyMinutes: a.everyMinutes ?? null,
      weekday: a.weekday ?? null, enabled: a.enabled, mode: a.mode ?? 'auto'
    })),
    connectors: cfg.mcpServers.map(s => ({
      id: s.id, name: s.name, kind: s.kind, enabled: s.enabled,
      permission: s.permission ?? 'allow', custom: s.kind === 'custom'
    }))
  }
  return JSON.stringify(doc, null, 2) + '\n'
}

export async function exportBrainConfig(gh: GitHubConfig, cfg: AppConfig): Promise<void> {
  if (!gh.accessToken || !gh.repoOwner) throw new Error('GitHub not configured')
  await github.pushMetadataFile(gh, 'keepmind.json', brainConfigJson(cfg), 'chore: refresh keepmind.json brain config')
}
