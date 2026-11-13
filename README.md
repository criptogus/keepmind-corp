<div align="center">

<img src="build/icon.png" width="120" alt="KeepMind logo" />

# 🧠 KeepMind

**An open-source, LLM-agnostic second brain.**
KeepMind is free and open source, with no paid plans.
Plug *any* LLM — local llama.cpp, Claude, Codex, GPT, Gemini, Grok, Ollama —
into persistent local Markdown memory synced to **your own GitHub repo**,
with optional end-to-end encryption.
Your knowledge is independent of any model: swap providers anytime, nothing is forgotten.
Runs on your desktop, a VPS, or a bot's own VM.

[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![llama.cpp](https://img.shields.io/badge/Local%20LLM-llama.cpp-22d3ee)](https://github.com/ggml-org/llama.cpp)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-a78bfa)](https://modelcontextprotocol.io/)
[![CI](https://github.com/criptogus/keepmind/actions/workflows/ci.yml/badge.svg)](https://github.com/criptogus/keepmind/actions/workflows/ci.yml)

![Platform](https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-supported-brightgreen)

</div>

---

## What it does

KeepMind is a persistent memory layer that works with **any LLM** — the model is a
replaceable runtime, the repo is the brain:

- **🔀 LLM-agnostic** — bundled [llama.cpp](https://github.com/ggml-org/llama.cpp) local model (fully offline), **Codex/ChatGPT sign-in**, **Claude Pro/Max** via `claude setup-token`, plus API keys for Anthropic, OpenAI, Gemini, Grok (xAI) and Ollama. Change providers whenever you want.
- **📦 Knowledge outlives models** — every conversation, insight and summary is Markdown in a **private GitHub repo created for you** via OAuth device flow. Not weights in a provider's silo — files you own, versioned and portable. Any AI that can read a repo can use it.
- **🖥️ Runs anywhere** — desktop app (Electron) on macOS/Windows/Linux, headless on a VPS, or installed by an agent on its own VM. A GitHub repo is the only hard requirement — it's the durable memory backend every LLM workflow already speaks.
- **🔌 Connectors (MCP)** — a generic MCP stdio client plus bundled servers: WhatsApp via QR (Baileys), Telegram bot, Postgres read-only, and *any* custom MCP server. LLMs call connector tools natively.
- **🧠 KeepMind MCP server** — the repo ships its own zero-dependency MCP server (`tools/keepmind-mcp.mjs`, Node 18+). Claude Code, Codex, Gemini CLI, Grok or any MCP client connects with one command and gets `sb_search` / `sb_read` / `sb_write` / `sb_remember` / `sb_tasks` — structured memory access, not just raw files.
- **🧭 Project continuity** — resume a project across assistants with its objective, reviewed decisions, rejected approaches, expected and observed results, source versions and next step. The desktop **Projetos** view and `continuity_*` MCP tools share the same versioned state; native model analysis proposes source-backed relationships for human review. [Workflow and current limits](docs/CONTINUITY.md).
- **🗓️ Current and historical facts** — chat, retrieval and standalone MCP use one dated-fact contract. Current recall excludes archived facts and pending proposals; historical reads are explicit, and undated material remains labelled unverified.
- **📄 Agent-ready repo** — on connect, the app pushes `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.mcp.json`, `.cursor/mcp.json`, `.cursor/rules/keepmind-memory.mdc` (Cursor Composer), `.gemini/settings.json` and the MCP server into your repo. Codex/Claude/Cursor/Gemini discover and use the memory automatically — see [`docs/CONNECT.md`](docs/CONNECT.md) for per-agent setup.
- **🧹 Weekly librarian** — a scheduled hygiene pass (consolidate old logs, dedupe long-term memory, refresh entities) keeps the knowledge base clean on its own.
- **🕸️ Entity layer** — recurring people/projects/topics get their own page in `memory/entities/` with `[[wikilinks]]` — a lightweight knowledge graph in plain Markdown.
- **🔁 Continuous GitHub sync** — the repo is the source of truth: every local memory write pushes in seconds, remote changes (written by Claude, Codex, Grok, or a bot on a VPS…) pull down automatically, before every chat.
- **🧠 Tiered memory + sleep cycles** — short/medium/long-term memory like a real brain. The nightly "sleep" cycle reviews the day (what works, what to fix, what to stop, what to start) and distills facts, lessons and reusable skills into long-term memory.
- **⚡ Natural-language automations** — "every day at 8am summarize my whatsapp" becomes a scheduled cron. Daily/interval/weekly, pause/resume/run-now.
- **🔐 Local accounts + Google sign-in** — SQLite auth (scrypt), PKCE loopback Google OAuth, session tokens. Your data stays on your machine.
- **🧪 Answer quality** — run six synthetic cases with the configured model (up to 12 calls), inspect model-judged results and validated citations, and compare compatible runs in **Qualidade**. Results are not a universal score.
- **🧮 Local semantic memory (RAG)** — optional embedding model (BGE/Nomic via llama.cpp) gives the brain meaning-based recall over everything it remembers — fully offline.
- **⚡ Laya decision engine** — vendored [laya-ts](https://github.com/NandhaKishorM/laya) (Apache-2.0) runs typed System-1 decisions on-device via ONNX (~33ms): memory classification, dedup gates and RAG reranking — the brain's reflexes, no LLM round-trip.
- **🤖 More AI providers** — bundled local model, **Codex/ChatGPT sign-in** (reuses `codex login`), **Claude Pro/Max** via `claude setup-token`, plus API keys for Anthropic, OpenAI, Gemini, Grok (xAI) and Ollama.
- **📅 Today command center** — daily intentions, open tasks and quick notes on one screen. The app opens here every morning.
- **📝 Notes** — Markdown notes in `memory/notes/`, synced and readable by every connected AI.
- **✅ Tasks** — lightweight to-dos with due dates and priorities in `memory/tasks/`.
- **💬 One learning brain** — a single chat interface grounded in your full memory: semantic recall, entity graph, tiered context. No persona switching — the LLM is the pluggable part.
- **✨ Neural UI** — a procedural synapse visualization (cyan/lime/amber on black) that literally *fires* when things happen in the app.
- **📋 Insights & daily summaries** — the brain analyzes your memory and surfaces what matters, automatically once a day.
- **🤖 Plug in your other AIs** — one copy-paste prompt teaches Claude, Codex, Grok or Gemini to read/write memory in your repo (emails sent, PDFs made, decisions — everything remembered).

## KeepMind Corp

The free desktop app above is the **individual** product. **KeepMind Corp** is the
same second brain plus organization governance, shipped primarily as an
**installable desktop app** (Windows `.exe`, macOS `.dmg`, Linux `.AppImage`) that
starts a local corp server automatically — no Docker or separate server install for
normal users. Details: [corp/README.md](corp/README.md), [docs/ENTERPRISE.md](docs/ENTERPRISE.md).

**End users / IT:** install **KeepMind Corp** from your team's build artifacts.

**Packagers:** `npm run dist:corp:mac` | `dist:corp:win` | `dist:corp:linux` (output in `dist-corp/`).

**Developers only** (hack the server/UI locally):

```bash
npm run corp:build-brain && npm run corp
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     RENDERER (React)                     │
│  BrainCore canvas · Chat · Dashboard · Wizard          │
└──────────────────────────┬──────────────────────────────┘
                           │ contextBridge (preload)
┌──────────────────────────▼──────────────────────────────┐
│                     MAIN PROCESS (Node)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │  Brain   │ │   LLM    │ │  GitHub  │ │  MCP Mgr    │ │
│  │ memory/  │ │ multi-   │ │ OAuth +  │ │ whatsapp ·  │ │
│  │ insights │ │ provider │ │ repo sync│ │ telegram ·  │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ │ postgres ·  │ │
│       │            │            │       │ custom      │ │
│  ┌────┴────────────┴────────────┴───────┴──────┬──────┘ │
│  │ GitSync ⇄ repo · Auth (SQLite) · Automations │        │
│  │ scheduler · Librarian · Entities · RAG       │        │
│  │ scheduler · RAG embeddings (llama-server :8766)      │
│  └─────────────────────────────────────────────┴────────┘ │
└────────────────────────────────────────────────┼────────┘
                                                 │ stdio JSON-RPC
              ┌──────────────────────────────────┼───────────┐
              ▼                                  ▼           ▼
      ┌───────────────┐              ┌────────────────┐  ┌─────────┐
      │ llama-server  │              │ whatsapp MCP   │  │ npx MCP │
      │ (local GGUF)  │              │ (Baileys/QR)   │  │ servers │
      └───────────────┘              └────────────────┘  └─────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Quickstart

```bash
git clone https://github.com/criptogus/keepmind.git
cd keepmind
npm install
npm run dev        # development (electron-vite)
npm run build      # production build
npm run dist       # installers via electron-builder → dist/
```

Releases are built automatically by GitHub Actions on every `v*` tag —
see [`.github/workflows/release.yml`](.github/workflows/release.yml).
Download the latest build from
[Releases](https://github.com/criptogus/keepmind/releases).

First launch walks you through a 4-step wizard:

1. **GitHub** — device-flow OAuth → creates a private `second-brain-*` repo.
2. **AI** — pick the bundled local model (~2 GB download) or paste an API key.
3. **Connectors** — optional: WhatsApp QR, Telegram bot token, Postgres URL.
4. Done — start chatting. Insights and a daily summary generate automatically.

## Run on a VPS or a bot's VM

KeepMind is a great fit for always-on memory: an agent (Grok, Claude, your own
bot) can install it on a VM and every chat — human or AI — shares the same
GitHub-backed memory.

Electron needs a display server even with no window, so on headless Linux use
`xvfb` plus the built-in headless mode (services only — sync, MCP servers,
LLM, automations — no BrowserWindow):

```bash
# one-time deps on Debian/Ubuntu
sudo apt install xvfb

npm install && npm run build
npm run start:headless        # = xvfb-run + SECOND_BRAIN_HEADLESS=1

# or the packaged build:
xvfb-run -a env SECOND_BRAIN_HEADLESS=1 ./dist/linux-unpacked/second-brain
xvfb-run -a env SECOND_BRAIN_HEADLESS=1 "./dist/KeepMind-0.1.1.AppImage"
```

`SECOND_BRAIN_HEADLESS=1` (or `--headless`) skips window creation entirely —
ideal for bots: lower RAM, no GUI deps beyond xvfb. SIGTERM/SIGINT shut down
cleanly (stops MCP servers, sync and schedulers), so it works under systemd:

```ini
# /etc/systemd/system/second-brain.service
[Unit]
Description=KeepMind (headless)
After=network-online.target

[Service]
ExecStart=/usr/bin/xvfb-run -a /opt/second-brain/second-brain
Environment=SECOND_BRAIN_HEADLESS=1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Point any MCP-capable agent at the same GitHub repo and it reads/writes the
same memory — that's the LLM-agnostic part.

## Memory layout (in your repo)

```
memory/
├── short-term/               # daily raw logs (working memory)
├── medium-term/              # weekly consolidations
├── long-term/                # facts.md, lessons.md, skills.md, notes/
├── sleep/                    # nightly learning reports
├── insights/  summaries/     # generated insights & daily summaries
├── notes/                    # user notes (Markdown)
├── tasks/                    # to-dos with due dates & priorities
├── daily/                    # daily intentions/goals
├── entities/                 # knowledge graph: one page per entity + index
├── meetings/                 # legacy: old roundtable transcripts
└── agents/                   # legacy: old per-agent notes
```

External AIs (Claude, Codex, Grok, Gemini…) can plug into the same repo —
the app generates a ready-to-paste prompt under **Brain → Plug in your AI**.

### Connect Codex / Claude / Grok / Cursor / bots directly

📖 **Full per-agent guide: [`docs/CONNECT.md`](docs/CONNECT.md)** — setup +
ready-to-paste prompt for Claude (Code/Desktop), Codex, Cursor, Gemini CLI,
Grok, Grokbot/bot VMs, and any custom agent (Hermes, Dots, Muse…).

Every connected repo contains `tools/keepmind-mcp.mjs` — a zero-dependency
MCP server over your `memory/` directory. Any MCP-capable agent gets
structured memory tools:

```bash
# Claude Code — already wired via the .mcp.json the app pushes
# Codex CLI / Gemini CLI / any MCP client:
node tools/keepmind-mcp.mjs --dir ./memory

# or from this repo / npm:
npx keepmind-mcp --dir /path/to/your/memory-clone
```

Available tools: `sb_search` (search memory first), `sb_read`, `sb_write`,
`sb_append`, `sb_remember` (durable fact/lesson/skill), `sb_recent`,
`sb_list`, `sb_tree`, `sb_tasks`, `sb_query` (structured filters) — plus
`memory://` resources for browsing.

## Tech stack

| Layer | Tech |
|---|---|
| Desktop | Electron 33 |
| Renderer | React 18 + TypeScript + Vite (electron-vite) |
| Local LLM | llama.cpp `llama-server` + GGUF (Qwen2.5 / Llama 3.2 / SmolLM2) |
| Protocol | MCP (Model Context Protocol) — custom stdio client + bundled WhatsApp server (Baileys) |
| GitHub | OAuth device flow + Contents API |
| Storage | Markdown files → your private repo |

## Roadmap

- [x] Scheduled agents (natural-language automations + sleep cycles)
- [x] Local semantic memory (RAG via llama.cpp embeddings)
- [x] Codex/ChatGPT sign-in as an AI backend
- [x] MCP server exposing memory to external agents (Claude, Codex, Grok…)
- [x] Agent-ready repo scaffold (AGENTS.md, CLAUDE.md, .mcp.json, bundled MCP server)
- [x] Weekly librarian hygiene automation + entity/knowledge-graph layer
- [ ] Composio as a universal connector (Gmail, Calendar, Notion, Drive…)
- [ ] Semantic search inside the standalone MCP server (embeddings endpoint)
- [ ] Real `git clone/push` sync in addition to the Contents API
- [ ] Mobile companion (read-only memory viewer)

## ⚠️ Notes & risks

- **WhatsApp** uses [Baileys](https://github.com/WhiskeySockets/Baileys), an *unofficial* library. WhatsApp may ban numbers that automate heavily. The connector is strictly opt-in.
- **Postgres** connector is read-only by design.
- Local models need RAM: ~4 GB (1.7B), ~6 GB (3B), ~12 GB+ (7B).

## Contributing

PRs welcome! Please open an issue first for big changes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © KeepMind contributors

## Encrypted GitHub sync

In **Settings → GitHub**, enable **Encrypt GitHub memory**, enter a strong
passphrase, and unlock sync. Enter the same passphrase on each device after
restarting KeepMind. The passphrase stays in process memory for that session;
it is never written to config, uploaded, or returned by IPC. Forgetting it means
losing access to the encrypted backup.

Before memory uploads, KeepMind uses libsodium's Argon2id (`crypto_pwhash`,
interactive limits: 2 operations and 64 MiB) to derive a 256-bit key from the
passphrase and a random per-repository salt. The public `.keepmind/crypto.json`
contains the version, KDF, salt, and an authenticated key-check ciphertext.
Each memory file starts with `KEEPMIND-ENCRYPTED:1` and contains a random nonce
and a `crypto_secretbox` authenticated ciphertext. Pulls verify and decrypt
before writing local Markdown. Wrong passphrases and tampered files fail closed.

The first encrypted sync rewrites existing local memory and imports remote-only
memory for encryption. A repository with an encryption header refuses plaintext
uploads even if its local toggle is disabled. Use a separate repository to return
to plaintext sync. Existing plaintext Git history is **not removed**: use a fresh
private repo if previous commits contain sensitive notes. Filenames, sizes, and
commit timing remain visible. Local Markdown and the local SQLite search index
remain plaintext, so protect the device and backups. The standalone MCP server
reads local decrypted Markdown; it cannot search a raw encrypted repository clone.

API credentials are sealed with Electron safeStorage. KeepMind refuses to save
secrets if the OS keyring is unavailable, fails, or uses Linux's `basic_text`
backend. Unlock/configure your system keyring and retry; no plaintext fallback
is used.

## Standalone MCP server

Requires Node.js 18+. The dependency-free `tools/` package is named
`keepmind-mcp` and can be packaged with `npm pack ./tools`. Once that package is
published to npm, install/run it with:

```bash
npx keepmind-mcp --memory-dir /absolute/path/to/memory
# Or: KEEPMIND_MEMORY_DIR=/absolute/path/to/memory npx keepmind-mcp
```

From a source checkout, no npm publication or Electron installation is needed:

```bash
node tools/keepmind-mcp.mjs --memory-dir /absolute/path/to/memory
# Local installation of the standalone package:
npm install -g ./tools
keepmind-mcp --memory-dir /absolute/path/to/memory
```

Use this stdio MCP configuration in Claude Code's `.mcp.json` or Cursor's
`.cursor/mcp.json` after installing the package (or replace `npx` and `args` with
`node` and the absolute script path from your checkout):

```json
{
  "mcpServers": {
    "keepmind": {
      "command": "npx",
      "args": ["-y", "keepmind-mcp", "--memory-dir", "/absolute/path/to/memory"]
    }
  }
}
```

`search` provides keyword search without an embedding model. `read_note` reads a
relative Markdown path. Existing `sb_*` tools also support writes, appends,
structured queries and durable memories. The server uses stdin/stdout for MCP
messages and stderr for diagnostics. `KEEPMIND_MEMORY_DIR` and `--memory-dir`
are preferred; legacy `SECOND_BRAIN_DIR` and `--dir` remain supported.

The desktop index uses `better-sqlite3-multiple-ciphers` on disk with WAL,
prepared statements and incremental transactional updates. FTS5 references the
chunk table without duplicating text; sensitive text uses HMAC token postings.
Vectors occupy Float32 BLOBs (sealed separately for sensitive chunks). Deterministic
hyperplane buckets retrieve bounded vector candidates; cosine reranks those and
BM25 candidates, then reciprocal rank fusion combines the ranks. Approximate
vector retrieval trades exhaustive recall for bounded query cost. Int8 storage is
not enabled: Float32 avoids additional quantization loss; size depends on vector
dimensions and the proportion of sealed chunks.

When memory encryption is configured, SQLCipher encrypts the database and WAL
using a domain-separated key derived from the memory master. Restricted columns
remain sealed independently. The previous sql.js schema migrates in place in a
transaction; JSON embeddings import only when no SQLite file exists. Original
JSON backups remain on disk and should be handled under the same security policy.
For Electron packaging, rebuild the native dependency for Electron's ABI with
`npx electron-builder install-app-deps` (Node tests require the Node ABI build).

## Third-party attribution

The vendored **laya-ts** runtime is licensed under Apache-2.0, separately from
KeepMind's MIT license. See [NOTICE](NOTICE), the preserved
[Apache-2.0 license](src/main/vendor/laya/LICENSE.laya), and
[vendoring notes](src/main/vendor/laya/VENDORED.md) for source and local changes.

### Memory security and native video capture

KeepMind uses its own memory model with item classifications, isolated spaces, themes and encrypted local search. Configure memory encryption and save the one-time recovery key in Settings before ingesting restricted material. Sensitive/secret data requires unlocked keys; cloud use requires explicit consent and PII redaction.

See [Security model](docs/SECURITY-MODEL.md) for key management, recovery, egress, sync and MCP scopes, and [Native ingestion and refresh](docs/INGESTION.md) for CLI commands, video tool configuration, theme routing and pipeline receipts.
