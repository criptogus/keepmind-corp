# Changelog

All notable changes to KeepMind are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.6] - 2026-11-12

### Fixed
- Crash on launch on all platforms: Electron upgraded from 33 to 35.7.5 (Node 22.16, N-API 10), which the bundled better-sqlite3-multiple-ciphers 13 prebuilds require. 0.2.4 and 0.2.5 crashed at startup.

## [0.2.5] - 2026-11-12

### Changed
- Sync keepmind-corp now merges main into criptogus/keepmind-corp over an SSH deploy key (secret `KEEPMIND_CORP_DEPLOY_KEY`) instead of a PAT mirror push.
- KeepMind is now completely free: removed the Stripe Pro plan, payment link and license-key activation from Settings.

### Fixed
- corp selfcheck no longer hangs CI: the GitHub sync scheduler timer is unref'd.
- Continuous and release builds use Python 3.11 and Windows Server 2022 runners for compatibility with node-gyp 9.4.1 during native dependency installation.

### Added
- **Continuous self-update** — every push to `main` rebuilds a rolling `continuous` prerelease (macOS/Windows/Linux); installed apps poll it on launch + every 6h, download the matching artifact and self-install (macOS bundle swap, Windows NSIS `/S`, Linux AppImage swap). Works unsigned; dedupes by release marker so it won't re-download while awaiting restart.
- **Webhook triggers** — any automation exposes `POST /hook/<id>` (token auth, localhost or LAN) so external apps (Zapier, n8n, GitHub Actions) can fire brain jobs; approval-mode jobs still queue for review.
- **Connector permissions** — per-MCP-server `allow`/`ask`/`block`; `ask` skips auto-start, `block` never spawns.
- **`keepmind.json` brain-as-code** — sanitized declarative snapshot (agents, automations, connectors, models; never secrets) pushed to the repo root so any clone/bot sees the brain's config.
- **Laya decision engine** — local ONNX "System 1" (~33ms) for inbox triage, memory classification, semantic dedup and RAG reranking.
- **Secret redaction for cloud LLMs** — secret-shaped spans masked before messages reach non-local providers; `sensitivity:` frontmatter convention documented.
- **Scripted brain jobs (zero LLM tokens)** — daily insights, daily summary, note enrichment and weekly consolidation are now deterministic: facts and structure over generated prose.
- Flashcards + spaced-repetition review, entity backlinks, `sb_query`, search-gap logging, security audit, skills evolution, activity journal, per-automation auto/approval modes.

### Security
- Memory path containment, IPC input validation + config whitelisting, sandboxed renderer, tightened CSP, secrets sealed via OS keychain, per-platform onnxruntime pruning (−200MB installer).

## [0.1.1] — 2026-11

### Added
- **Auto-updater** — packaged builds check GitHub Releases on launch and every 6h, download in the background, and offer one-click restart. Settings → Updates.
- **Chat history persistence** — conversations survive view switches and restarts (per-agent, local).
- Richer Markdown rendering in chat (headings, lists, todos, fenced code blocks) shared with Notes/Meetings preview.
- Copy button on assistant messages.
- Releases now ship macOS universal (Intel + Apple Silicon), Windows x64/ARM64 and Linux AppImage builds.

### Changed
- Neural background canvas runs in a lite mode and pauses when the window is hidden — much lower RAM/CPU footprint.

## [0.1.0] — 2026-11

### Added
- Local-first Electron app: Markdown memory synced bidirectionally with a private GitHub repo (source of truth).
- Tiered memory (short / medium / long-term) + nightly "sleep" learning cycle with 5-question review.
- Specialist agents (Buffett, Gates, Musk, Naval, Jobs + custom personas) and multi-agent **Meetings** that produce transcripts and action items.
- Today dashboard: daily intentions, tasks with due dates/priorities, quick notes.
- Natural-language automations (daily / interval / weekly crons).
- AI providers: bundled local llama.cpp model, Codex/ChatGPT sign-in, Claude Pro/Max token, Anthropic, OpenAI, Gemini, Grok, Ollama.
- Local accounts (SQLite + scrypt) and Google sign-in (PKCE loopback).
- Local semantic memory (RAG) with BGE/Nomic embeddings via llama.cpp.
- MCP connectors: WhatsApp (QR), Telegram, Postgres read-only, custom servers.
- Stripe Pro plan ($19/mo) support.
