# Installed application validation

KeepMind SB is the personal second-brain application, not KeepMind OS. Its existing internal package name (`keepmind`), bundle identifier (`com.keepmind.app`) and profile directory remain stable. The macOS bundle remains `KeepMind.app` for compatibility with already-installed updaters; its display name, UI and new artifact names identify KeepMind SB. Corp keeps its own identity and profile.

## Account persistence

Accounts and sessions belong to the profile, outside the installed app. On macOS the personal default remains `~/Library/Application Support/keepmind`; Corp uses `keepmind-corp`. Replacing or removing the application bundle does not remove these directories. Windows NSIS explicitly retains application data on uninstall. A local SB session expires after 30 days; expiration requires login, not registration. Removing profile data with a cleaner is different from uninstalling the application. No password or account is copied between SB and Corp.

Explicit `--user-data-dir` and `KEEPMIND_USER_DATA_DIR` profiles survive updater relaunches. Neither changes HOME. Regression tests preserve a synthetic account across app replacement and confirm an expired session leaves the account intact.

## Publication finding

The old `continuous.yml` used the personal packaging configuration even inside `keepmind-corp`. Both published macOS 0.2.6 DMGs contained `name: keepmind`, `main: out/main/index.js`. The workflow now chooses the Corp config, builds Corp resources, uploads the correct output folder and includes shared main-process chunks. Corp polls only its own repository and accepts only Corp-prefixed artifacts.

## Update guarantees and limits

Downloads require the expected repository, edition-specific filename, positive size and SHA-256 digest. Partial or corrupted downloads are not installable. Pending metadata persists across restart. The macOS helper stages the replacement on the installation volume, keeps the old bundle for recovery, and preserves the profile when launching directly. It does not use LaunchServices to choose another app. Linux requires a real AppImage path and stages a replacement. Windows waits for the old process, installs to its existing directory, checks the installer exit status, then relaunches with the same profile. A receipt is written after replacement, not after download.

These changes do not add signing/notarization or remote account recovery. Existing unsigned application restrictions still apply. A local source-package smoke is not evidence that a published release contains the fix.

## Reusable tests

- `node scripts/packaged-mac-smoke.mjs APP_PATH personal|corp EVIDENCE_DIR`: copy a built app into a fresh temporary installation, create a synthetic account, remove/reinstall the app, then exercise the real updater against a controlled local archive, verifying relaunch, session, sentinel data and recovery bundle. An outer macOS sandbox denies writes to the user's home; Electron's nested sandbox is disabled only for this test process because nested seatbelt sandboxes conflict.
- `node scripts/packaged-platform-smoke.mjs INSTALLER personal|corp EVIDENCE_DIR`: Windows/Linux equivalent, restricted to disposable CI runners. Uses the native NSIS installer/uninstaller or AppImage and preserves a temporary profile.
- `.github/workflows/installed-apps.yml`: builds and tests both editions on macOS, Windows and Linux. Screenshots, reports and process logs are retained as workflow artifacts.

The fixture feed is injected through the test process's inspector; production builds contain no arbitrary update-server override. Never test update application against a user's installation, account, vault or credentials. Reports distinguish published artifacts from newly packaged source builds.

## Windows helper startup

The native regression exposed `powershell.exe` exiting with code 0 before executing its script when launched with Node's `detached` option. A hidden `cmd /c start /b /wait` bootstrap supplies a console and starts PowerShell outside the parent's libuv job. The app waits for a readiness file before quitting; startup failures keep the app open. See [libuv Windows process handling](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c) and the [matching upstream reproduction](https://github.com/oven-sh/bun/issues/31603). Native lifecycle CI exercises the real helper after the parent exits.

Auth database writes use an atomic replacement and propagate disk errors. Failed mutations restore the in-memory database so a later read cannot silently save a failed registration. The regression verifies both retry and reopen behavior.
