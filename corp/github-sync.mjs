import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { walkMarkdown, resolveInside } from './lib.mjs'
import { getFileMeta, putFile, listDir } from './github-api.mjs'
import { getOrgSecret } from './org-secrets.mjs'
import { readGithubSync, writeGithubSync } from './github-sync-store.mjs'

function collectSharedFiles(vault) {
  const root = path.join(vault, 'shared')
  const files = []
  for (const f of walkMarkdown(root)) {
    if (f.rel.startsWith('crm/teams/')) continue
    files.push({
      vaultRel: `shared/${f.rel}`,
      abs: f.abs,
      content: readFileSync(f.abs, 'utf8'),
      updatedAt: statSync(f.abs).mtimeMs
    })
  }
  const policy = path.join(vault, 'ops', 'corp-policy.json')
  if (existsSync(policy)) {
    files.push({
      vaultRel: 'ops/corp-policy.json',
      abs: policy,
      content: readFileSync(policy, 'utf8'),
      updatedAt: statSync(policy).mtimeMs
    })
  }
  return files
}

function ghPath(cfg, vaultRel) {
  return `${cfg.repoPrefix}/${vaultRel}`.replace(/\/+/g, '/')
}

export async function runGithubSync(vault, direction = 'both') {
  const cfg = readGithubSync(vault)
  if (!cfg.enabled || !cfg.owner || !cfg.repo) {
    const err = new Error('GitHub sync not configured.')
    err.code = 'github_off'
    throw err
  }
  const token = getOrgSecret(vault, 'github')
  if (!token) {
    const err = new Error('GitHub token missing in Chaves org.')
    err.code = 'github_off'
    throw err
  }
  let pushed = 0
  let pulled = 0
  const errors = []

  if (direction === 'push' || direction === 'both') {
    for (const file of collectSharedFiles(vault)) {
      if (file.content.startsWith('KMS1\n')) continue
      const remotePath = ghPath(cfg, file.vaultRel)
      try {
        const meta = await getFileMeta(token, cfg.owner, cfg.repo, remotePath, cfg.branch)
        const remoteSha = meta?.sha
        const remoteAt = meta?.sha ? Date.parse(meta?.commit?.committer?.date || '') || 0 : 0
        if (remoteAt && file.updatedAt <= remoteAt && remoteSha) continue
        await putFile(token, cfg.owner, cfg.repo, remotePath, file.content, `corp: ${file.vaultRel}`, cfg.branch, remoteSha)
        pushed += 1
      } catch (e) {
        errors.push(`${file.vaultRel}: ${e.message}`)
      }
    }
  }

  if (direction === 'pull' || direction === 'both') {
    // Prefer a read-only PAT for pulls when configured; fall back to the RW token.
    const pullToken = getOrgSecret(vault, 'github_readonly') || token
    try {
      const base = ghPath(cfg, 'shared')
      const items = await listDir(pullToken, cfg.owner, cfg.repo, base, cfg.branch)
      for (const item of items) {
        if (item.type !== 'file' || !String(item.name).endsWith('.md')) continue
        const vaultRel = `shared/${item.name}`
        const located = resolveInside(vault, vaultRel)
        if (!located) continue
        const content = Buffer.from(item.content, 'base64').toString('utf8')
        const remoteAt = Date.parse(item.commit?.committer?.date || '') || 0
        let localAt = 0
        try { localAt = statSync(located.abs).mtimeMs } catch { /* new */ }
        if (localAt >= remoteAt && localAt > 0) continue
        mkdirSync(path.dirname(located.abs), { recursive: true })
        writeFileSync(located.abs, content)
        pulled += 1
      }
    } catch (e) {
      errors.push(`pull: ${e.message}`)
    }
  }

  const msg = `push ${pushed}, pull ${pulled}${errors.length ? `; ${errors.length} errors` : ''}`
  writeGithubSync(vault, {
    lastPushAt: pushed ? new Date().toISOString() : cfg.lastPushAt,
    lastPullAt: pulled ? new Date().toISOString() : cfg.lastPullAt,
    lastMessage: msg
  })
  return { ok: errors.length === 0, pushed, pulled, errors, message: msg }
}
