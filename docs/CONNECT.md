# Connecting agents to your KeepMind

Your KeepMind memory lives in **your own GitHub repo** — plain Markdown under
`memory/` plus a zero-dependency MCP server (`tools/keepmind-mcp.mjs`).
Any agent that can read a repo or speak MCP can plug in.

There are **two ways** to connect, pick whichever the agent supports:

| Method | Best for | Setup |
|---|---|---|
| **MCP server** | Claude Code/Desktop, Cursor, Gemini CLI, Codex, Windsurf, any MCP client | one config block — the repo ships ready-made configs |
| **Repo + prompt** | Grok, bots on VMs (Grokbot…), custom agents (Hermes, Dots, Muse…) | clone the repo, paste the agent prompt below |

The app pushes `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.mcp.json`,
`.cursor/mcp.json`, `.cursor/rules/keepmind-memory.mdc`, `.gemini/settings.json`
and the MCP server into your repo automatically on connect — most agents need
**zero manual config**.

For project handoff, start with `continuity_list` and `continuity_context`.
Keep the server's `lib/memory-contract.mjs` and `lib/continuity.mjs` modules beside
the entry point when copying it. Encrypted memory still needs the native unlock
mechanism and launcher-controlled scopes. See [Project continuity](CONTINUITY.md)
for decisions, evidence changes, revisions and the first-project workflow.

---

## Universal prompt (works with ANY agent)

Paste this into any chat/agent that can access your repo (GitHub MCP, `gh`
CLI, or a local clone):

```text
You are now connected to my "KeepMind" — a private GitHub repository that is
my long-term memory. Use it like persistent memory across every session.

REPOSITORY: <YOUR_REPO_URL>

## Memory layout
- memory/short-term/YYYY-MM-DD.md — daily raw logs (working memory). WRITE here.
- memory/medium-term/ — weekly consolidations (app-managed, read-only)
- memory/long-term/ — facts.md, lessons.md, skills.md, notes/ (durable memory)
- memory/entities/ — knowledge graph, one page per person/project/topic
- memory/notes/, tasks/, daily/ — user notes, to-dos, daily goals
- memory/review/ — spaced-repetition flashcards
- memory/insights/, summaries/, sleep/ — generated reports (read-only)
- memory/projects/ — structured project state (use continuity tools to change it)

## If the repo has tools/keepmind-mcp.mjs (it should)
Prefer the MCP server over raw file edits:
  node tools/keepmind-mcp.mjs --dir ./memory
Tools: sb_search, sb_read, sb_write, sb_append, sb_remember, sb_recent,
sb_list, sb_tree, sb_tasks, sb_query, plus memory:// resources.

## Rules
- BEFORE answering about me/my work: search memory first.
- When resuming a project: call continuity_list, then continuity_context. Preserve
  accepted decisions, rejected approaches, original predictions and evidence status.
- Update projects with continuity tools and the returned expectedRevision. On a
  conflict, reread and reconcile. Decisions remain proposals until human review.
- Default fact reads are current; request history or asOf explicitly when needed.
- AFTER meaningful work: APPEND to memory/short-term/YYYY-MM-DD.md under
  "## HH:MM — <your-name>". Never rewrite or delete existing entries.
- Markdown only, append-only, one file per day per source.
- Secrets, passwords, API keys: NEVER save.
- Commit and push at session end: "memory: YYYY-MM-DD <agent>".
- If you can't write to GitHub, end replies with a "## MEMORY BLOCK"
  section containing the exact markdown to append.

Confirm by listing the top 5 things you remember about me.
```

The app's Dashboard also generates this prompt with your repo URL pre-filled
(**Brain → Plug in your AI**).

---

## Claude (Pro/Max)

**Claude Code** — zero config: the repo's `.mcp.json` is auto-detected when
you open the cloned repo. Or add manually to `~/.claude.json`:

```json
{
  "mcpServers": {
    "keepmind": {
      "command": "node",
      "args": ["/ABS/PATH/TO/REPO/tools/keepmind-mcp.mjs", "--dir", "/ABS/PATH/TO/REPO/memory"]
    }
  }
}
```

**Claude Desktop** — edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`):

```json
{
  "mcpServers": {
    "keepmind": {
      "command": "node",
      "args": ["/ABS/PATH/TO/REPO/tools/keepmind-mcp.mjs", "--dir", "/ABS/PATH/TO/REPO/memory"]
    }
  }
}
```

Then paste the universal prompt in a new chat. `CLAUDE.md` in the repo root
points Claude at `AGENTS.md` automatically.

## Codex (CLI / ChatGPT)

Codex reads `AGENTS.md` natively — the repo already has one. Two options:

- **MCP**: add to `~/.codex/config.toml`:
  ```toml
  [mcp_servers.keepmind]
  command = "node"
  args = ["/ABS/PATH/TO/REPO/tools/keepmind-mcp.mjs", "--dir", "/ABS/PATH/TO/REPO/memory"]
  ```
- **No MCP**: `codex` inside the cloned repo + universal prompt. Codex can
  also reuse your ChatGPT login — the KeepMind app itself supports
  **Codex/ChatGPT sign-in** as an AI provider (no API key).

## Cursor (editor + Chat)

Clone/open the repo — `.cursor/mcp.json` is already in it. Cursor picks it
up under **Settings → MCP**. If the repo isn't local, add the server
manually in `.cursor/mcp.json` or Cursor settings with the same
`command`/`args` as above.

## Cursor Composer (Agent) — recommended

**Composer** is Cursor's agent mode. It uses the same MCP server as the
inline chat, plus a workspace rule so every agent turn searches memory first.

On connect, KeepMind also pushes:

- `.cursor/mcp.json` — `keepmind` MCP server
- `.cursor/rules/keepmind-memory.mdc` — always-on rule (`sb_search` before
  answers, `sb_append` / `sb_remember` after work)

Setup:

1. Open the repo in Cursor.
2. **Settings → MCP** — confirm **keepmind** is enabled.
3. Open **Composer** (Agent), not only the side chat.
4. First message: *"Leia AGENTS.md e busque na memória antes de responder."*

The desktop app's **Connectors** screen has a **Cursor Composer** card with
copy-paste snippets. In **KeepMind Corp**, enable the **Cursor Composer**
agent in **Admin → Agentes** so policy allows that connector class (app).

**Corp remote vault:** run `tools/corp-mcp-bridge.mjs` with org URL + sync token
(`mcp:invoke` scope) and register that command in `.cursor/mcp.json` instead of
local `keepmind-mcp.mjs`.

## Gemini CLI

`.gemini/settings.json` ships in the repo — Gemini CLI loads it
automatically. Manual equivalent in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "keepmind": { "command": "node", "args": [".../tools/keepmind-mcp.mjs", "--dir", ".../memory"] }
  }
}
```

`GEMINI.md` routes Gemini to `AGENTS.md` for conventions.

## Grok (xAI)

Grok has no native MCP client — use the **repo + prompt** path:

1. Give Grok repo access (GitHub connector, or paste files).
2. Paste the universal prompt with your repo URL.
3. Grok reads `AGENTS.md`, searches memory before answering, and appends
   session logs to `memory/short-term/` — push via GitHub MCP or the
   MEMORY BLOCK fallback.

For Grokbot-style setups (an agent with its own VM), see below — that's
the strongest pattern: the bot installs KeepMind itself.

## Grokbot / any bot with a VM

The bot can run the full stack on its own machine:

```bash
# 1. clone your brain repo
git clone https://github.com/<you>/<your-brain-repo>.git && cd <repo>

# 2. memory server (no deps, Node 18+)
node tools/keepmind-mcp.mjs --dir ./memory

# 3. or the whole app headless (needs xvfb on Linux)
xvfb-run -a env SECOND_BRAIN_HEADLESS=1 electron .
```

Then point the bot's MCP config at `tools/keepmind-mcp.mjs` — it wakes up
with your full persistent memory, and anything it writes syncs back to
your repo (and to your desktop app) automatically.

## Webhook triggers (external apps → automations)

Any automation can expose an HTTP trigger. Enable **HOOK** on an
automation card and the app listens locally:

```bash
curl -X POST http://127.0.0.1:4789/hook/<automation-id> \
  -H "x-hook-token: <token shown in the UI>" \
  -d '{"source":"zapier"}'
```

- Token auth via `x-hook-token` header, `?token=` query, or `Authorization: Bearer`
- Responds `202` immediately; the job runs in background
- Approval-mode automations queue for your OK instead of running
- 5s debounce per automation; body capped at 64KB
- Binds `127.0.0.1` by default — for remote triggers (VPS, n8n, Zapier)
  use an SSH tunnel or reverse proxy, or enable LAN mode in the app

Works with GitHub Actions, Zapier, n8n, Home Assistant, cron on another
machine — anything that can POST.

## keepmind.json (brain as code)

The repo root contains `keepmind.json` — a sanitized snapshot of your
agents, automations, connectors and model prefs (never secrets). Bots
that clone the repo can read it to replicate your setup. Refresh it any
time with the **BRAIN CONFIG** button or `brain:exportConfig`.

## Hermes, Dots, Muse & other custom agents

Any agent that can run a command or read files works:

- **MCP-capable** → register `node tools/keepmind-mcp.mjs --dir ./memory`
  as an MCP server (same JSON shape as `.mcp.json`).
- **File/CLI access only** → clone the repo and paste the universal
  prompt. `AGENTS.md` teaches it the layout and conventions.
- **API-only (no filesystem)** → use the MEMORY BLOCK fallback in the
  prompt: the agent ends each reply with markdown to append, you (or a
  sync script) commit it.

If a specific agent needs a different config format, open an issue —
adding a scaffold file is a one-liner.

## Troubleshooting

- **"memory not found"** → the MCP server needs `--dir` pointing at the
  repo's `memory/` folder (or run it from inside the cloned repo).
- **Agent ignores memory** → make sure it read `AGENTS.md` first; the
  prompt's "search before answering" rule is what makes recall happen.
- **Writes not syncing** → the desktop app pulls/pushes continuously;
  agents should `git pull` before reading and `git push` after writing.
