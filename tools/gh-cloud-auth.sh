#!/usr/bin/env bash
# Use GH_TOKEN / GITHUB_TOKEN from Cloud Agent secrets for gh + git push as criptogus.
set -euo pipefail
TOKEN="$(printf '%s' "${GH_TOKEN:-${GITHUB_TOKEN:-}}" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [ -z "$TOKEN" ]; then
  echo "[gh-cloud-auth] No GH_TOKEN/GITHUB_TOKEN — using Cursor GitHub App token (limited repo scope)."
  gh auth status -h github.com 2>/dev/null || true
  exit 0
fi
if ! command -v gh >/dev/null; then
  echo "[gh-cloud-auth] gh CLI not installed; skip" >&2
  exit 0
fi
# Validate before gh login — a bad secret breaks gh until GH_TOKEN is cleared.
if ! curl -fsS -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/user" >/dev/null 2>&1; then
  echo "[gh-cloud-auth] GH_TOKEN/GITHUB_TOKEN is set but rejected by GitHub (401). Fix the secret in Cloud Agents → Secrets." >&2
  unset GH_TOKEN GITHUB_TOKEN
  export GH_TOKEN= GITHUB_TOKEN=
  gh auth status -h github.com 2>/dev/null || true
  exit 0
fi
printf '%s\n' "$TOKEN" | gh auth login --hostname github.com --with-token
gh auth setup-git
LOGIN="$(gh api user -q .login 2>/dev/null || echo unknown)"
echo "[gh-cloud-auth] Active GitHub user: $LOGIN"
