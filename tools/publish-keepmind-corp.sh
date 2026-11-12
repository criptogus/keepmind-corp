#!/usr/bin/env bash
# Publish monorepo branch to github.com/criptogus/keepmind-corp (main).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REF="${1:-cursor/corp-roadmap-v02-e37c}"
REMOTE="${KEEPMIND_CORP_REMOTE:-keepmind-corp}"
SSH_KEY="${KEEPMIND_CORP_SSH_KEY:-$ROOT/.ssh-corp-push/keepmind-corp}"
URL="${KEEPMIND_CORP_URL:-https://github.com/criptogus/keepmind-corp.git}"
if [ -f "$SSH_KEY" ]; then
  URL="${KEEPMIND_CORP_SSH_URL:-git@github.com:criptogus/keepmind-corp.git}"
  export GIT_SSH_COMMAND="ssh -i \"$SSH_KEY\" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
fi

if ! git remote get-url "$REMOTE" &>/dev/null; then
  git remote add "$REMOTE" "$URL"
else
  git remote set-url "$REMOTE" "$URL"
fi

if [ ! -f "$SSH_KEY" ]; then
  # gh breaks when Cloud GH_TOKEN is invalid — unset for this check only.
  ( unset GH_TOKEN GITHUB_TOKEN; gh repo view criptogus/keepmind-corp &>/dev/null ) || {
    echo "Repository criptogus/keepmind-corp not visible."
    exit 1
  }
fi

push_target() {
  if [ -f "$SSH_KEY" ]; then
  # Cursor rewrites git@github.com → cursor[bot] HTTPS; bypass for deploy-key SSH.
    GIT_SSH_COMMAND="$GIT_SSH_COMMAND" \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    git -c commit.gpgsign=false push -u git@github.com:criptogus/keepmind-corp.git "${REF}:main"
    return
  fi
  git push -u "$REMOTE" "${REF}:main"
}

if ! push_target; then
  echo ""
  echo "Push failed."
  if [ -f "$SSH_KEY" ]; then
    echo "  • Add deploy key (write) on keepmind-corp: repo Settings → Deploy keys"
    echo "    Public key: ${SSH_KEY}.pub"
  else
    echo "  • Secret GH_TOKEN on Cloud environment, or Cursor App access to keepmind-corp"
  fi
  exit 1
fi
echo "Pushed ${REF} -> keepmind-corp:main"
