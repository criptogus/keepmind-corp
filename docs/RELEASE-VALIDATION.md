# Release validation

KeepMind tags (`v*`), Corp tags (`corp-v*`) and the rolling continuous release use:

```text
same-commit CI (tests + both smokes + verified reports)
  → installer builds: macOS, Windows, Linux
    → one publisher
```

The local reusable `ci.yml` runs at the caller commit. Every build depends on validation; publication depends on validation and the full build matrix. Failed, cancelled or skipped dependencies prevent publication under GitHub's default `needs` semantics. No publishing dependency overrides that behavior with `always()` or `continue-on-error`.

Validation covers typecheck, desktop build, Corp brain build/selfcheck, unit/integration tests, Experience smoke and CRM browser smoke on Linux. Installer builds still run on all three platforms; these are not installed-app smoke tests. Packaging uses `--publish never`. Only the final publisher has contents write permission and downloads matching installer artifacts from its own workflow run.

CI retains smoke reports and screenshots for 14 days, including failed runs when artifacts exist. The report checker rejects missing, empty, incomplete, duplicate or failed checks. The workflow checker is deliberately strict: changing required commands requires reviewing its contract and mutation tests together.

Run `npm run check:release-gates` for the aggregate structural check (nonzero on failure). Run the CI commands for execution evidence, then `node scripts/check-release-gates.mjs --reports`. See `.agents/skills/release-validation/SKILL.md` for the reusable validation procedure. Neither command publishes anything. Static mutation tests validate the checker, not GitHub's scheduler. A real tagged release is deliberately not part of PR validation.

References: [reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), [workflow syntax and job dependencies](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
