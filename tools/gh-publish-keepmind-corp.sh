#!/usr/bin/env bash
# Publish keepmind main → keepmind-corp using the GitHub CLI (gh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Invalid Cloud GH_TOKEN overrides gh hosts.yml and breaks every gh call.
if [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then
  if ! curl -fsS -H "Authorization: token ${GH_TOKEN:-$GITHUB_TOKEN}" \
    "https://api.github.com/user" >/dev/null 2>&1; then
    echo "[gh-publish] Ignoring invalid GH_TOKEN/GITHUB_TOKEN in environment."
    unset GH_TOKEN GITHUB_TOKEN
    export GH_TOKEN= GITHUB_TOKEN=
  fi
fi

if ! command -v gh >/dev/null; then
  echo "gh CLI not found." >&2
  exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "Not logged in. Run: gh auth login -h github.com -p https -w" >&2
  exit 1
fi

LOGIN="$(gh api user -q .login 2>/dev/null || true)"
if [ "$LOGIN" != "criptogus" ]; then
  echo "gh is logged in as '${LOGIN:-unknown}', not criptogus." >&2
  echo "Run: gh auth login -h github.com -p https -w" >&2
  exit 1
fi

git fetch origin main
SHA="$(git rev-parse origin/main)"
echo "[gh-publish] Sync criptogus/keepmind (${SHA:0:7}) → keepmind-corp:main"

if gh repo sync criptogus/keepmind-corp --source criptogus/keepmind --branch main --force; then
  echo "[gh-publish] Done via gh repo sync."
  exit 0
fi

echo "[gh-publish] gh repo sync failed; trying git push with gh credentials…"
BRANCH="${1:-main}"
./tools/publish-keepmind-corp.sh "$BRANCH"