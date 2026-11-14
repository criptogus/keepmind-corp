# KeepMind shared brain

The real-memory service and compact interface used by the desktop app. This package preserves the existing native features through **Ferramentas avançadas**. Shared views activate only when the existing connection explicitly selects a shared vault; the corporate edition retains its own backend.

## Build and test

Requires Bun and Python 3 on macOS for the background installer.

```sh
bun install --frozen-lockfile
bun run backend:build
bun test ./tests/*.test.*
bun run build:native
```

`npm run dist:mac` at the repository root packages the service and UI as resources. The app still reports the upstream 0.2.6 version; this is a local source build, not a published release.

## Existing Mac installation

Stop the existing `io.keepmind.brain` LaunchAgent only when no jobs are running, then run `python3 scripts/install-background.py` and bootstrap the resulting per-user LaunchAgent. The installer requires Bun on PATH; it copies code and assets into the stable user runtime without changing vault settings, keys, original Markdown, MCP client configuration, decisions or quota state. Back up the runtime before an upgrade. The packaged installer also works from `KeepMind.app/Contents/Resources/brain/scripts/`.

The service uses the existing shared-vault choice in the user's `second-brain/ui-bridge-connection.json`. This installer does not select a vault or unlock an encrypted one. Writes remain confined to the shared adapter's generated area. Source documents and GitHub encryption are not migrated.

## Reliability and evidence

Read-only MCP calls recover once after a transport failure, sharing one replacement connection. Writes are never replayed automatically: an ambiguous result must be checked before retry. Encrypted sessions do not retain passphrases for automatic recovery. Permanent failures remain visible.

The isolated tests cover timeouts, process exits, malformed protocol data, UTF-8 framing, authorization, source boundaries, reversible proposals, daily limits, usage receipts, feedback and skill evolution. They do not establish productivity gains versus plain GitHub; that requires prospective measurements on real tasks.

Personal vault contents, benchmark transcripts, local state and credentials are deliberately excluded from this repository.
