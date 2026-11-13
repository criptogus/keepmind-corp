---
name: release-validation
description: Validate KeepMind and Corp release gates before changing publishing workflows or preparing a release PR.
---

Run from the repository root. Never trigger a release or create a tag merely to test gates.

1. Run `npm ci`, then `npm run check:release-gates`. The script parses all three publishing workflows and rejects absent or bypassed validation prerequisites.
2. Run the commands in `.github/workflows/ci.yml` in order, including both browser smokes and `node scripts/check-release-gates.mjs --reports`. On macOS use a physical temporary directory (`TMPDIR=/private/tmp`) for tests and CRM smoke; symlinked temp parents intentionally fail storage safety checks.
3. Run actionlint against the four changed workflows when available, and `git diff --check`.
4. Record actual test counts, skips, smoke reports and failures/retries in the PR. Retain smoke artifacts. Do not claim static mutation tests exercised GitHub's scheduler or installer publishing.
5. After opening the PR, inspect checks for its current commit. A failure or missing report is not success. Publication and merge require the user's existing authorization; this skill grants neither.

Use the existing checker and smoke scripts; do not duplicate them. See `docs/RELEASE-VALIDATION.md` for scope and limitations.

After a continuous release, check the current commit in the release body, successful validation/build/publish ordering, nonempty uploaded assets, and every `latest*.yml` file URL against the literal published asset name and size. Download manifest files to verify their GitHub digest, and verify installer SHA-512 before repairing a manifest. A green publisher job alone does not prove updater URLs work. Never silently normalize mismatching names; an HTTP 404 is a failure. Record repairs separately from the original workflow run.

For installer/updater/profile changes, run the packaged lifecycle tests in `docs/INSTALLED-APP-VALIDATION.md`, and inspect the three-platform Installed application lifecycle workflow. Require actual app opening, account/session continuity after reinstall, and successful update/relaunch; checksum-only publication checks are insufficient. Use disposable profiles and installations. Keep production application identity/profile paths stable when changing branding. Never interpret an expired session as a missing account.

## UI changes before release

For repeated UX validation, reuse `npm run test:experience` after building the renderer;
this single batch writes an aggregate JSON report and screenshots and fails on any
assertion or browser error. Keep adding meaningful journeys to this existing batch,
not a separate runner. The value/continuity flow and synthetic visual fixture are
specified in `docs/VALUE-UX-VALIDATION.md`; onboarding is covered in
`docs/ONBOARDING-VALIDATION.md`. Run relevant unit tests and typecheck as well.
Inspect the actual rendered UI at the native minimum window size and a compact
viewport, including keyboard focus, error/retry and both motion preferences.
Do not replace visual judgment with a green report or claim real AI behavior from
synthetic bridge data. Preserve the user's app/profile; never enter real credentials
or private content in preview fixtures.
