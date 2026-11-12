import { readGithubSync } from './github-sync-store.mjs'
import { runGithubSync } from './github-sync.mjs'

const TICK_MS = 5 * 60_000

export function startGithubSyncScheduler(vault, { audit } = {}) {
  const tick = async () => {
    const cfg = readGithubSync(vault)
    if (!cfg.scheduleEnabled || !cfg.enabled || !cfg.owner || !cfg.repo) return
    try {
      const result = await runGithubSync(vault, 'both')
      audit?.('system', 'github_sync_auto', { message: result.message })
    } catch (e) {
      audit?.('system', 'github_sync_auto_fail', { message: e.message })
    }
  }
  const timer = setInterval(() => {
    tick().catch(() => {})
  }, TICK_MS)
  timer.unref?.()
  tick().catch(() => {})
  return () => clearInterval(timer)
}
