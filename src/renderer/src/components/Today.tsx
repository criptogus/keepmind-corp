import { useCallback, useEffect, useState } from 'react'

interface LedgerEntry {
  ts: string | number
  verb: 'processed' | 'discovered' | 'improved' | 'needs-you'
  sentence: string
  path?: string
}

interface Pending { id: string; name: string; instruction: string; kind: string }
interface Fact { id: string; text: string; since: string; origin: string; source: string; previous: string }
interface HealthStats {
  files: number
  mdFiles: number
  entities: number
  writes7d: number
  topSources: { source: string; count: number }[]
  automationsEnabled: number
  automationsTotal: number
  skills: number
}

const VERB: Record<LedgerEntry['verb'], string> = {
  processed: 'Processed',
  discovered: 'Discovered',
  improved: 'Improved',
  'needs-you': 'Needs you'
}

// Hoje é um observatório, não um app de produtividade: o usuário abre para ver
// o que o cérebro fez, o que melhorou e o que precisa de decisão. Tarefas,
// briefing pessoal e estudo ficam com o LLM/agente dele — aqui é telemetria
// do segundo brain.
export default function Today({ onToast }: { onToast?: (m: string, k?: 'info' | 'error' | 'success') => void }) {
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [facts, setFacts] = useState<Fact[]>([])
  const [policy, setPolicy] = useState<{ active: string; proposals: string[] } | null>(null)
  const [health, setHealth] = useState<HealthStats | null>(null)
  const [sleepLine, setSleepLine] = useState('')
  const [evalScore, setEvalScore] = useState<{ day: string; hit: number; total: number } | null>(null)

  const load = useCallback(async () => {
    const [led, pend, queue, pol, hl, sleeps, scored] = await Promise.all([
      window.sb.brainLedger(40).catch(() => []),
      window.sb.automationPending().catch(() => []),
      window.sb.brainFacts().catch(() => []),
      window.sb.brainPolicy().catch(() => null),
      window.sb.brainHealth().catch(() => null),
      window.sb.brainListSleep().catch(() => []),
      window.sb.brainEval().catch(() => null)
    ])
    setLedger(led ?? [])
    setPending(pend ?? [])
    setFacts(queue ?? [])
    setPolicy(pol)
    setHealth(hl?.stats ?? null)
    setEvalScore(scored?.last ?? null)
    const last = (sleeps ?? [])[0]
    if (last) {
      const line = String(last.content ?? '').split('\n').map((l: string) => l.trim()).find((l: string) => l && !l.startsWith('#') && !l.startsWith('_'))
      setSleepLine(line ? `${last.date}: ${line.slice(0, 180)}` : `Last sleep on ${last.date}.`)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const off = window.sb.onJob?.(() => { load() })
    return () => { off?.() }
  }, [load])

  const approve = async (p: Pending) => {
    await window.sb.automationApprove(p.id)
    onToast?.(`"${p.name}" approved and running.`, 'success')
    await load()
  }
  const reject = async (p: Pending) => {
    await window.sb.automationReject(p.id)
    await load()
  }
  const applyPolicy = async () => {
    const msg = await window.sb.brainPolicyApply()
    onToast?.(String(msg), 'success')
    await load()
  }

  const todayCount = ledger.filter(e => Date.now() - new Date(e.ts).getTime() < 86_400_000).length
  const decisions = pending.length + facts.length + ((policy?.proposals.length ?? 0) > 0 ? 1 : 0)
  const topSources = (health?.topSources ?? []).slice(0, 4)

  const groups: LedgerEntry['verb'][] = ['needs-you', 'discovered', 'improved', 'processed']

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>HOJE</div>
          <h1>What the brain did</h1>
          <p className="dim" style={{ fontSize: 14, marginTop: 6, maxWidth: 640, lineHeight: 1.5 }}>
            Second-brain telemetry: completed work, discoveries and improvements — plus what needs your decision. Day-to-day interaction happens in your LLM.
          </p>
        </div>
      </div>

      {/* vitals */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 22, maxWidth: 1000 }}>
        {[
          { k: 'events today', v: todayCount, sub: `${ledger.length} recentes` },
          { k: 'writes 7d', v: health?.writes7d ?? '—', sub: 'in the vault' },
          { k: 'active sources', v: topSources.length, sub: topSources.map(s => s.source).join(', ') || '—' },
          { k: 'active crons', v: health ? `${health.automationsEnabled}/${health.automationsTotal}` : '—', sub: 'automations' },
          { k: 'decisions', v: decisions, sub: decisions ? 'need you' : 'all clear' },
          { k: 'memory', v: health?.mdFiles ?? '—', sub: `${health?.skills ?? 0} skills` }
        ].map(m => (
          <div key={m.k} className="card stat" style={{ padding: '12px 14px' }}>
            <div className="stat__num" style={{ fontSize: 20 }}>{m.v}</div>
            <div className="stat__label">{m.k}</div>
            <div className="faint" style={{ fontSize: 9.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {(sleepLine || evalScore) && (
        <p className="faint" style={{ fontSize: 12, marginBottom: 18 }}>
          {sleepLine && <>Last sleep — {sleepLine}</>}
          {sleepLine && evalScore && ' · '}
          {evalScore && <span title="Checks whether expected words appear in retrieved memory. This does not measure the accuracy of an AI answer.">Retrieval checks on {evalScore.day}: {evalScore.hit}/{evalScore.total}</span>}
        </p>
      )}

      {/* ── decisions ── */}
      <div className="hud-tag" style={{ marginBottom: 10 }}>NEEDS YOU</div>

      {pending.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h2>Cron approvals ({pending.length})</h2>
          {pending.map(p => (
            <div key={p.id} className="note-row" style={{ alignItems: 'flex-start', cursor: 'default' }}>
              <div style={{ flex: 1 }}>
                <strong>{p.name}</strong>
                <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>{p.instruction}</p>
              </div>
              <button className="btn btn--primary btn--sm" onClick={() => approve(p)}>Aprovar</button>
              <button className="btn btn--ghost btn--sm" onClick={() => reject(p)}>Recusar</button>
            </div>
          ))}
        </div>
      )}

      {facts.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h2>Facts proposed by the brain ({facts.length})</h2>
          <p className="dim" style={{ fontSize: 13, margin: '6px 0 10px' }}>
            Sleep, chat, webhooks and agents leave proposals. Only what you accept becomes fact.
          </p>
          {facts.map(f => (
            <div key={f.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ fontSize: 14 }}>{f.text}</div>
              <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>{f.since} · {f.origin} · {f.source}</p>
              {f.previous && (
                <p className="dim" style={{ fontSize: 13, marginTop: 6 }}>Replacing: {f.previous}</p>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button className="btn btn--primary btn--sm" onClick={async () => { await window.sb.brainFactAccept(f.id); onToast?.('Fact accepted.', 'success'); await load() }}>Aceitar</button>
                <button className="btn btn--ghost btn--sm" onClick={async () => { await window.sb.brainFactDiscard(f.id); await load() }}>Descartar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(policy?.proposals.length ?? 0) > 0 && (
        <div className="card card-pad" style={{ marginBottom: 22 }}>
          <h2>Brain policy proposal</h2>
          <p className="dim" style={{ fontSize: 13, marginTop: 6 }}>{policy?.active}</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>{policy?.proposals[policy.proposals.length - 1]}</p>
          <button className="btn btn--primary btn--sm" style={{ marginTop: 10 }} onClick={applyPolicy}>Apply to active policy</button>
        </div>
      )}

      {decisions === 0 && (
        <p className="faint" style={{ fontSize: 13, marginBottom: 22 }}>Nothing pending — the brain is operating within the current policy.</p>
      )}

      {/* ── what the brain did ── */}
      <div className="hud-tag" style={{ marginBottom: 10 }}>RECENT ACTIVITY</div>
      {groups.map(verb => {
        const items = ledger.filter(e => e.verb === verb).slice(0, 6)
        if (!items.length) return null
        return (
          <div key={verb} style={{ marginBottom: 16 }}>
            <h2>{VERB[verb]}</h2>
            <div className="card" style={{ marginTop: 8 }}>
              {items.map((e, i) => (
                <div key={`${e.ts}-${i}`} className="note-row" style={{ cursor: 'default' }}>
                  <span className="note-row__title">{e.sentence}</span>
                  <span className="faint mono" style={{ fontSize: 11, flexShrink: 0 }}>
                    {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {e.path ? ` · ${e.path}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {ledger.length === 0 && (
        <div className="card card-pad">
          <p className="dim" style={{ fontSize: 13 }}>No activity recorded yet. Connect an agent or run a cron for the brain to start logging work.</p>
        </div>
      )}
    </div>
  )
}
