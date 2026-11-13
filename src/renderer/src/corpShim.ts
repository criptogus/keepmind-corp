// Corporate web edition: same KeepMind UI, backed by the self-hosted Corp API.

import { installBrowserShim } from './browserShim'

async function j<T>(pathname: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(pathname, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-keepmind-corp': '1', ...(options.headers || {}) },
    ...options
  })
  if (res.status === 401) {
    window.location.href = '/'
    throw new Error('unauthorized')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.message || body.error || 'request failed'), { code: body.error })
  return body as T
}

export function installCorpShim() {
  if (typeof window === 'undefined' || (window as any).sb) return
  installBrowserShim()
  const base = (window as any).sb
  let deltaCb: ((t: string) => void) | null = null

  const corp = {
    ...base,
    // The Corp endpoint cannot abort a server-side generation yet.
    brainCancel: undefined,
    continuity: async () => {
      throw new Error('Projetos e retomada entre IAs estão disponíveis no aplicativo KeepMind. Esta edição Corp ainda não oferece esse serviço.')
    },
    projectAnalyze: async () => { throw new Error('A análise de projetos está disponível no aplicativo KeepMind SB.') },
    answerBenchmarkRun: async () => { throw new Error('A avaliação de respostas está disponível no aplicativo KeepMind SB.') },
    answerBenchmarkList: async () => { throw new Error('A avaliação de respostas está disponível no aplicativo KeepMind SB.') },
    answerBenchmarkCancel: async () => false,
    crm: async (action: string, args: Record<string, unknown> = {}) => {
      if (action === 'snapshot') return j(`/api/crm?board=${encodeURIComponent(String(args.board || 'personal'))}`)
      return j('/api/crm', { method: 'POST', body: JSON.stringify({ action, args }) })
    },
    memorySecurityStatus: async () => ({ configured: false, unlocked: true, space: 'personal', encryptAll: false }),
    getConfig: async () => j('/api/brain/config'),
    setConfig: async (patch: Record<string, unknown>) => {
      await j('/api/brain/config', { method: 'PATCH', body: JSON.stringify(patch) })
      return corp.getConfig()
    },
    updateAi: async (patch: Record<string, unknown>) => {
      await j('/api/brain/config', { method: 'PATCH', body: JSON.stringify(patch) })
      const c = await corp.getConfig()
      return { ...c.ai, ...patch }
    },
    brainLedger: async (limit?: number) => j(`/api/brain/ledger?limit=${limit ?? 40}`),
    brainHealth: async () => j('/api/brain/health'),
    brainGraph: async () => j('/api/brain/graph'),
    brainActivity: async (limit?: number) => j(`/api/brain/activity?limit=${limit ?? 30}`),
    brainListMemory: async () => j('/api/brain/memory'),
    brainMemoryFile: async (rel: string) => {
      const row = await j<{ content: string }>(`/api/brain/memory/file?path=${encodeURIComponent(rel)}`)
      return row.content
    },
    brainSearch: async (query: string) => j(`/api/brain/search?q=${encodeURIComponent(query)}`),
    brainFacts: async () => j('/api/brain/facts'),
    brainBriefing: async () => (await j<{ text: string }>('/api/brain/briefing')).text,
    brainPolicy: async () => j('/api/brain/policy'),
    brainEval: async () => j('/api/brain/eval'),
    brainListSleep: async () => j('/api/brain/list-sleep'),
    brainCapture: async (text: string) => j('/api/brain/capture', { method: 'POST', body: JSON.stringify({ text }) }),
    brainExport: async () => j('/api/brain/export'),
    brainImport: async (files: { path: string; content: string }[]) =>
      j('/api/brain/import', { method: 'POST', body: JSON.stringify({ files }) }),
    brainChat: async (_agentId: string, message: string) => {
      const row = await j<{ reply: string }>('/api/brain/chat', { method: 'POST', body: JSON.stringify({ message }) })
      const text = row.reply
      for (const w of text.split(/(\s+)/)) {
        deltaCb?.(w)
        await new Promise(r => setTimeout(r, 12))
      }
      return text
    },
    onBrainDelta: (cb: (t: string) => void) => {
      deltaCb = cb
      return () => { deltaCb = null }
    },
    authState: async () => {
      const row = await j<{ user: { id: string; email: string; name: string } | null; orgNamespace: string }>('/api/session')
      if (!row.user) return { needsSetup: true, user: null }
      return { needsSetup: false, user: { id: `${row.orgNamespace}:${row.user.id}`, email: row.user.email, name: row.user.name } }
    },
    securityScan: async () => {
      try {
        const raw = await j<{ ok: boolean; scan: { secrets?: { path: string; line: number; label: string }[]; pii?: { path: string; line: number; label: string }[]; secretTotal: number; piiTotal: number } }>('/api/scan')
        const scan = raw.scan
        const hits = (scan.secrets ?? []).map(h => ({ ...h, encrypted: false }))
        const piiHits = (scan.pii ?? []).map(h => ({ ...h, encrypted: false }))
        return {
          hits,
          totalHits: scan.secretTotal,
          byLabel: {},
          unencryptedHits: scan.secretTotal,
          piiHits,
          piiTotal: scan.piiTotal,
          piiByLabel: {}
        }
      } catch {
        return { hits: [], totalHits: 0, byLabel: {}, unencryptedHits: 0, piiHits: [], piiTotal: 0, piiByLabel: {} }
      }
    },
    openExternal: async (url: string) => { window.open(url, '_blank', 'noopener,noreferrer') }
  }

  ;(window as any).sb = corp
  ;(window as any).__KEEPMIND_CORP__ = true
  ;(window as any).__KEEPMIND_DEMO__ = false
}
