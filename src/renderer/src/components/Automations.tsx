import { useEffect, useRef, useState } from 'react'
import { IconClock, IconMoon, IconSync, IconPlay, IconTrash, IconSparkle } from './icons'

interface Automation {
  id: string
  name: string
  instruction: string
  kind: 'brain' | 'sleep' | 'summary' | 'librarian' | 'evolve' | 'enrich' | 'review' | 'security' | 'skills' | 'triage' | 'briefing' | 'escalate' | 'compact' | 'gaps'
  schedule: 'daily' | 'interval' | 'weekly'
  time?: string
  everyMinutes?: number
  weekday?: number
  enabled: boolean
  mode?: 'auto' | 'approval'
  webhook?: boolean
  webhookToken?: string
  lastRunAt?: string
  lastSummary?: string
  createdAt: string
}

interface PendingApproval {
  id: string
  automationId: string
  name: string
  kind: string
  instruction: string
  createdAt: string
}

interface ActivityEntry {
  ts: number
  op: 'write' | 'append' | 'remove'
  path: string
  source: string
}

interface Parsed {
  kind: string
  schedule: string
  label: string
  time?: string
  everyMinutes?: number
  weekday?: number
  name: string
}

const KIND_LABEL: Record<string, string> = {
  brain: 'tarefa livre',
  sleep: 'sono',
  summary: 'resumo',
  librarian: 'organização',
  evolve: 'evolução',
  enrich: 'enriquecimento',
  review: 'sua revisão',
  security: 'segurança',
  skills: 'habilidades',
  triage: 'triagem',
  briefing: 'resumo do dia',
  escalate: 'tarefas',
  compact: 'compactação',
  gaps: 'lacunas'
}

const KINDS = Object.keys(KIND_LABEL)

// Ready-made self-learning crons — one click installs them.
const TEMPLATES: { emoji: string; name: string; desc: string; input: any }[] = [
  { emoji: '🌙', name: 'Sono noturno', desc: '23h — revisa o dia e reúne fatos, lições e habilidades.', input: { name: 'Nightly sleep cycle', kind: 'sleep', schedule: 'daily', time: '23:00', instruction: 'Nightly learning cycle: review the day and distill durable memory.' } },
  { emoji: '📊', name: 'Resumo da manhã', desc: '8h — resume o dia anterior e prepara o dia.', input: { name: 'Morning summary', kind: 'summary', schedule: 'daily', time: '08:00', instruction: 'Daily summary of yesterday and briefing for today.' } },
  { emoji: '🧹', name: 'Organização semanal', desc: 'Segunda às 9h — organiza registros e memória.', input: { name: 'Weekly librarian', kind: 'librarian', schedule: 'weekly', weekday: 1, time: '09:00', instruction: 'Weekly vault hygiene: consolidate old logs, dedupe long-term memory, refresh entity pages.' } },
  { emoji: '🧬', name: 'Evolução semanal', desc: 'Domingo às 18h — revisa relatórios e propõe melhorias.', input: { name: 'Weekly evolution', kind: 'evolve', schedule: 'weekly', weekday: 0, time: '18:00', instruction: 'Meta-learning: review sleep reports and insights, propose improvements to the memory system itself.' } },
  { emoji: '✨', name: 'Enriquecimento noturno', desc: '2h30 — adiciona resumos, etiquetas e links às notas recentes.', input: { name: 'Nightly note enrichment', kind: 'enrich', schedule: 'daily', time: '02:30', instruction: 'Enrich recent notes with summaries, topic tags and entity wikilinks.' } },
  { emoji: '🃏', name: 'Sua revisão', desc: 'Todos os dias às 20h — reúne cartões para sua revisão.', input: { name: 'Human review queue', kind: 'review', schedule: 'daily', time: '20:00', instruction: 'Put due flashcards on Today for the person to grade.' } },
  { emoji: '🛡️', name: 'Auditoria de segurança', desc: 'Domingo às 7h — procura credenciais expostas na memória.', input: { name: 'Security audit', kind: 'security', schedule: 'weekly', weekday: 0, time: '07:00', instruction: 'Scan all memory files for leaked secrets and credentials; report exposures without printing values.' } },
  { emoji: '📈', name: 'Evolução de habilidades', desc: 'Sábado às 10h — revisa e consolida habilidades.', input: { name: 'Skills evolution', kind: 'skills', schedule: 'weekly', weekday: 6, time: '10:00', instruction: 'Review procedural skills: dedupe, merge, prune stale ones, propose which deserve dedicated pages.' } },
  { emoji: '⚡', name: 'Triagem da caixa de entrada', desc: 'A cada 6h — organiza capturas em seus destinos.', input: { name: 'Fast inbox triage', kind: 'triage', schedule: 'interval', everyMinutes: 360, instruction: 'Triage inbox captures into the right memory destinations using fast decisions.' } },
  { emoji: '🔍', name: 'Lacunas de busca', desc: 'Sexta às 18h — relaciona buscas a arquivos já existentes.', input: { name: 'Close search gaps', kind: 'gaps', schedule: 'weekly', weekday: 5, time: '18:00', instruction: 'Match unanswered searches to files already in memory.' } },
  { emoji: '🗜️', name: 'Compactar memória', desc: '23h20 — remove duplicações e compacta a memória.', input: { name: 'Compact long-term memory', kind: 'compact', schedule: 'daily', time: '23:20', instruction: 'Drop duplicate lines and keep long-term files inside the prompt budget.' } },
  { emoji: '☀️', name: 'Resumo do dia', desc: '8h05 — prepara o dia com tarefas, metas e notas recentes.', input: { name: 'Morning briefing', kind: 'briefing', schedule: 'daily', time: '08:05', instruction: 'Write the daily briefing from tasks, goals and recent notes.' } }
]

function scheduleLabel(a: Automation): string {
  if (a.schedule === 'interval') {
    const m = a.everyMinutes ?? 60
    return m < 60 ? `a cada ${m} min` : m < 1440 ? `a cada ${m / 60} h` : `a cada ${m / 1440} dias`
  }
  if (a.schedule === 'weekly') {
    const d = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][a.weekday ?? 1]
    return `toda ${d}, às ${a.time ?? '09:00'}`
  }
  return `todos os dias às ${a.time ?? '08:00'}`
}

export default function Automations({ onActivity, onToast }: { onActivity?: () => void; onToast?: (m: string, k?: 'info' | 'error' | 'success') => void }) {
  const [autos, setAutos] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [pending, setPending] = useState<PendingApproval[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [tiers, setTiers] = useState<any>(null)
  const [sleepReports, setSleepReports] = useState<any[]>([])
  const [sync, setSync] = useState<any>(null)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [draftKind, setDraftKind] = useState('brain')
  const [draftTime, setDraftTime] = useState('08:00')
  const [busy, setBusy] = useState<string | null>(null)
  const [sleeping, setSleeping] = useState(false)
  const [hookInfo, setHookInfo] = useState<Record<string, { url: string; token: string }>>({})
  const parseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = async () => {
    setLoading(true); setLoadError('')
    try {
    const [a, p, act, t, s, sy] = await Promise.all([
      window.sb.automationList(),
      window.sb.automationPending(),
      window.sb.brainActivity(120),
      window.sb.brainMemoryTiers(),
      window.sb.brainListSleep(),
      window.sb.syncStatus()
    ])
    setAutos(a ?? []); setPending(p ?? []); setActivity(act ?? []); setTiers(t); setSleepReports(s ?? []); setSync(sy)
    } catch (e: any) { setLoadError(e?.message || 'Não foi possível carregar as rotinas.') }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  // live NL → schedule preview
  useEffect(() => {
    if (parseTimer.current) clearTimeout(parseTimer.current)
    if (!text.trim()) { setParsed(null); return }
    parseTimer.current = setTimeout(async () => {
      try {
        const next = await window.sb.automationParse(text)
        setParsed(next)
        if (next?.kind) setDraftKind(next.kind)
        if (next?.time) setDraftTime(next.time)
      } catch { /* noop */ }
    }, 350)
    return () => { if (parseTimer.current) clearTimeout(parseTimer.current) }
  }, [text])

  const addTemplate = async (t: (typeof TEMPLATES)[number]) => {
    setBusy(`tpl-${t.name}`)
    try {
      await window.sb.automationCreate(t.input)
      onToast?.(`"${t.name}" agendada ✓`, 'success')
      await refresh()
    } catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }

  const create = async () => {
    if (!text.trim()) return
    setBusy('create')
    try {
      await window.sb.automationCreate({
        instruction: text,
        kind: draftKind,
        time: draftTime || undefined
      })
      setText(''); setParsed(null)
      onToast?.('Rotina agendada ✓', 'success')
      await refresh()
    } catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }

  const toggle = async (a: Automation) => {
    await window.sb.automationUpdate(a.id, { enabled: !a.enabled })
    await refresh()
  }
  const runNow = async (a: Automation) => {
    setBusy(a.id); onActivity?.()
    try { await window.sb.automationRunNow(a.id); onToast?.(`"${a.name}" executada`, 'success'); await refresh() }
    catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }
  const remove = async (a: Automation) => {
    if (!window.confirm(`Remover "${a.name}" da agenda?`)) return
    await window.sb.automationRemove(a.id)
    await refresh()
  }
  const setMode = async (a: Automation, mode: 'auto' | 'approval') => {
    await window.sb.automationUpdate(a.id, { mode })
    await refresh()
  }
  const setWebhook = async (a: Automation) => {
    setBusy(`wh-${a.id}`)
    try {
      const r: any = await window.sb.automationSetWebhook(a.id, !a.webhook)
      if (r?.url) setHookInfo(prev => ({ ...prev, [a.id]: { url: r.url, token: r.token } }))
      else setHookInfo(prev => { const n = { ...prev }; delete n[a.id]; return n })
      onToast?.(r?.webhook ? `Webhook live: ${r.url}` : 'Webhook desativado', 'success')
      await refresh()
    } catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }
  const exportConfig = async () => {
    setBusy('export')
    try { await window.sb.brainExportConfig(); onToast?.('keepmind.json pushed to repo root ✓', 'success') }
    catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }
  const approve = async (p: PendingApproval) => {
    setBusy(`ap-${p.id}`)
    try { await window.sb.automationApprove(p.id); onToast?.(`"${p.name}" aprovada e em execução`, 'success'); await refresh() }
    catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }
  const reject = async (p: PendingApproval) => {
    await window.sb.automationReject(p.id)
    await refresh()
  }

  const sleepNow = async () => {
    setSleeping(true); onActivity?.()
    try {
      const r = await window.sb.brainSleep()
      onToast?.(r?.summary || 'Ciclo de sono concluído. O relatório está em Hoje.', 'success')
      await refresh()
      // surface the report
      const reports = await window.sb.brainListSleep()
      setSleepReports(reports ?? [])
      void r
    } catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setSleeping(false) }
  }

  const syncNow = async () => {
    setBusy('sync')
    try { await window.sb.syncNow(); await refresh(); onToast?.('Sincronizado com o GitHub ✓', 'success') }
    catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag hud-tag--amber" style={{ marginBottom: 6 }}>Agenda</div>
          <h1>Rotinas</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Programe tarefas para o KeepMind executar e acompanhe os resultados.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn--ghost" onClick={exportConfig} disabled={busy === 'export' || !sync?.connected} title="Enviar configuração keepmind.json para o repositório">
            ⤴ {busy === 'export' ? 'Exportando…' : 'Configuração'}
          </button>
          <button className="btn btn--ghost" onClick={syncNow} disabled={busy === 'sync' || !sync?.connected}>
            <IconSync size={12} /> {busy === 'sync' ? 'Sincronizando…' : sync?.connected ? 'Sincronizar agora' : 'Sem repositório'}
          </button>
        </div>
      </div>

      {loading && <p role="status">Carregando rotinas…</p>}
      {loadError && <div role="alert" className="card card-pad" style={{ marginBottom: 16 }}>Não foi possível carregar os dados: {loadError} <button className="btn" onClick={() => void refresh()}>Tentar novamente</button></div>}
      {/* Memory tiers */}
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--cyan)' }}>{tiers?.shortTerm ?? '—'}</div><div className="stat__label">Curto prazo · dias</div></div>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--amber)' }}>{tiers?.mediumTerm ?? '—'}</div><div className="stat__label">Médio prazo · semanas</div></div>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--lime)' }}>{tiers?.longTerm ?? '—'}</div><div className="stat__label">Longo prazo · fatos</div></div>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--violet)' }}>{tiers?.sleepCycles ?? '—'}</div><div className="stat__label">Ciclos de sono</div></div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        {/* New automation */}
        <div className="card card-pad">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconClock size={15} /> Nova rotina</h2>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
            Descreva em uma frase. A hora e o tipo aparecem abaixo e podem ser corrigidos antes de gravar.
          </p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Ex.: todos os dias às 8h, prepare um resumo…"
            rows={3}
            style={{
              width: '100%', marginTop: 12, padding: '12px 14px', borderRadius: 12,
              background: 'rgba(3,7,18,.7)', border: '1px solid var(--line)',
              color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12.5,
              resize: 'vertical', outline: 'none'
            }}
          />
          {parsed && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              <span className="chip" style={{ borderColor: 'rgba(34,211,238,.35)', color: 'var(--cyan)' }}>{parsed.label}</span>
              <select value={draftKind} onChange={e => setDraftKind(e.target.value)} style={{ background: 'transparent', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px' }}>
                {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <input type="time" value={draftTime} onChange={e => setDraftTime(e.target.value)} style={{ background: 'transparent', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px' }} />
            </div>
          )}
          <button
            className="btn btn--primary"
            style={{ marginTop: 14 }}
            disabled={!text.trim() || busy === 'create'}
            onClick={create}
          >
            <IconSparkle size={12} /> {busy === 'create' ? 'Agendando…' : 'Agendar'}
          </button>
        </div>

        {/* Sleep mode */}
        <div className="card card-pad" style={{ borderColor: 'rgba(167,139,250,.25)' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconMoon size={15} /> Sono</h2>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
            O ciclo de sono revisa o dia e pode guardar fatos, lições e habilidades.
          </p>
          <button
            className="btn"
            style={{ marginTop: 14, borderColor: 'rgba(167,139,250,.4)', color: '#c4b5fd' }}
            disabled={sleeping}
            onClick={sleepNow}
          >
            <IconMoon size={12} /> {sleeping ? 'Consolidando…' : 'Executar sono agora'}
          </button>
          {sync?.lastPull && (
            <p className="faint mono" style={{ fontSize: 10.5, marginTop: 12 }}>
              última atualização do GitHub {new Date(sync.lastPull).toLocaleTimeString()} · {sync.pending} envio(s) pendente(s)
            </p>
          )}
        </div>
      </div>

      {/* Pending approvals — automations in 'approval' mode queue here */}
      {pending.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 20, borderColor: 'rgba(251,191,36,.35)' }}>
          <h2 style={{ color: 'var(--amber)' }}>⏳ Aguardando sua aprovação ({pending.length})</h2>
          <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>
            Estas rotinas precisam da sua aprovação para executar.
          </p>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map(p => (
              <div key={p.id} className="insight-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{p.name}</strong>
                    <span className="chip" style={{ fontSize: 9.5 }}>{KIND_LABEL[p.kind] ?? p.kind}</span>
                  </div>
                  <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>{p.instruction}</p>
                  <p className="faint mono" style={{ fontSize: 10.5, marginTop: 4 }}>
                    na fila desde {new Date(p.createdAt).toLocaleString()}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn--primary" style={{ padding: '6px 14px', fontSize: 10 }} disabled={busy === `ap-${p.id}`} onClick={() => approve(p)}>
                    {busy === `ap-${p.id}` ? '…' : 'APROVAR'}
                  </button>
                  <button className="btn btn--ghost" style={{ padding: '6px 12px', fontSize: 10, color: '#f87171' }} onClick={() => reject(p)}>
                    REJEITAR
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Learning templates */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
          <h2>Modelos</h2>
        <p className="faint" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
          Escolha uma rotina pronta. As que já estão instaladas aparecem desabilitadas.
        </p>
        <div className="grid grid-3" style={{ marginTop: 14 }}>
          {TEMPLATES.map(t => {
            const installed = autos.some(a => a.name === t.input.name)
            return (
              <div key={t.name} className="card card-pad" style={{ padding: '14px 16px', opacity: installed ? .55 : 1 }}>
                <div style={{ fontSize: 18, marginBottom: 6 }}>{t.emoji}</div>
                <strong style={{ fontSize: 13 }}>{t.name}</strong>
                <p className="faint" style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5, minHeight: 34 }}>{t.desc}</p>
                <button
                  className="btn btn--ghost"
                  style={{ marginTop: 8, padding: '5px 12px', fontSize: 10, width: '100%' }}
                  disabled={loading || !!loadError || installed || busy === `tpl-${t.name}`}
                  onClick={() => addTemplate(t)}
                >
                  {installed ? 'INSTALADO ✓' : busy === `tpl-${t.name}` ? 'ADICIONANDO…' : '+ ADICIONAR'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Active automations */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h2>Rotinas ativas ({autos.filter(a => a.enabled).length}/{autos.length})</h2>
        {loading ? <p role="status">Carregando rotinas…</p> : loadError ? <p>Não foi possível carregar as rotinas.</p> : autos.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, marginTop: 12, lineHeight: 1.6 }}>
            Nenhuma rotina cadastrada. Descreva uma acima, por exemplo:{' '}
            <em>"todas as manhãs às 7h, resuma o dia anterior"</em>.
          </p>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {autos.map(a => (
              <div key={a.id} className="insight-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{a.name}</strong>
                    <span className="chip" style={{ fontSize: 9.5 }}>{scheduleLabel(a)}</span>
                    <span className="chip" style={{ fontSize: 9.5, opacity: .8 }}>{KIND_LABEL[a.kind]}</span>
                    <button
                      className="chip"
                      title={a.mode === 'approval' ? 'Executa após sua aprovação; clique para modo automático' : 'Executa automaticamente; clique para exigir aprovação'}
                      onClick={() => setMode(a, a.mode === 'approval' ? 'auto' : 'approval')}
                      style={{
                        fontSize: 9.5, cursor: 'pointer',
                        borderColor: a.mode === 'approval' ? 'rgba(251,191,36,.5)' : 'rgba(52,211,153,.35)',
                        color: a.mode === 'approval' ? 'var(--amber)' : 'var(--lime)',
                        background: a.mode === 'approval' ? 'rgba(251,191,36,.08)' : 'rgba(52,211,153,.06)'
                      }}
                    >
                      {a.mode === 'approval' ? '⏳ APROVAÇÃO' : '⚡ AUTOMÁTICO'}
                    </button>
                    <button
                      className="chip"
                      title={a.webhook ? 'Webhook ativo; clique para desativar' : 'Ativar webhook (POST /hook/<id> com token)'}
                      onClick={() => setWebhook(a)}
                      style={{
                        fontSize: 9.5, cursor: 'pointer',
                        borderColor: a.webhook ? 'rgba(34,211,238,.5)' : 'var(--line)',
                        color: a.webhook ? 'var(--cyan)' : 'var(--muted)',
                        background: a.webhook ? 'rgba(34,211,238,.08)' : 'transparent'
                      }}
                    >
                      {busy === `wh-${a.id}` ? '…' : a.webhook ? '🔗 HOOK' : '⊘ HOOK'}
                    </button>
                    {!a.enabled && <span className="chip" style={{ fontSize: 9.5, opacity: .6 }}>pausada</span>}
                  </div>
                  <p className="faint" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{a.instruction}</p>
                  <p className="faint mono" style={{ fontSize: 10.5, marginTop: 6 }}>
                    última execução: {a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : 'nunca'}
                    {a.lastSummary ? ` · ${a.lastSummary}` : ''}
                  </p>
                  {a.webhook && (hookInfo[a.id] || a.webhookToken) && (
                    <div className="mono" style={{ marginTop: 6, fontSize: 10, background: 'rgba(3,7,18,.6)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', wordBreak: 'break-all' }}>
                      <div style={{ color: 'var(--muted)' }}>POST {(hookInfo[a.id]?.url) ?? `http://127.0.0.1:4789/hook/${a.id}`}</div>
                      <div style={{ color: 'var(--cyan)', marginTop: 2 }}>token: ••••{(hookInfo[a.id]?.token ?? a.webhookToken ?? '').slice(-6)}</div>
                      <div style={{ color: 'var(--muted)', marginTop: 4 }}>cabeçalho: <code>x-hook-token</code> · rotinas em modo de aprovação entram na fila</div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn--ghost" style={{ padding: '6px 12px', fontSize: 10 }} disabled={busy === a.id} onClick={() => runNow(a)}>
                    <IconPlay size={10} /> {busy === a.id ? '…' : 'EXECUTAR'}
                  </button>
                  <button className="btn btn--ghost" style={{ padding: '6px 12px', fontSize: 10 }} onClick={() => toggle(a)}>
                    {a.enabled ? 'PAUSAR' : 'RETOMAR'}
                  </button>
                  <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 10, color: '#f87171' }} onClick={() => remove(a)}>
                    <IconTrash size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity feed — everything the brain wrote/changed, with source */}
      <div className="card card-pad">
        <h2>Atividade recente</h2>
        <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>
          Alterações na memória e suas origens.
        </p>
        {loading ? <p role="status">Carregando atividade…</p> : loadError ? <p>Não foi possível carregar a atividade.</p> : activity.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, marginTop: 12 }}>Nenhuma atividade ainda.</p>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 380, overflowY: 'auto' }}>
            {activity.map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, fontSize: 12 }} className="insight-item">
                <span style={{ width: 14, textAlign: 'center', flexShrink: 0 }}>
                  {e.op === 'write' ? '✎' : e.op === 'append' ? '＋' : '🗑'}
                </span>
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.path}</span>
                <span className="chip" style={{ fontSize: 9, flexShrink: 0, opacity: .85 }}>{e.source}</span>
                <span className="faint mono" style={{ fontSize: 10, flexShrink: 0 }}>{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sleep reports */}
      {sleepReports.length > 0 && (
        <div className="card card-pad">
          <h2>Relatórios de sono</h2>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sleepReports.slice(0, 10).map((r: any) => (
              <details key={r.date} className="insight-item" style={{ cursor: 'pointer' }}>
                <summary style={{ flex: 1, listStyle: 'none' }}>
                  <span className="mono" style={{ fontSize: 12 }}>🌙 {r.date}</span>
                </summary>
                <div className="msg__body" style={{ fontSize: 12.5, marginTop: 10 }} dangerouslySetInnerHTML={{ __html: md(r.content) }} />
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function md(s: string) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/### (.+)/g, '<div style="margin-top:12px"><strong style="color:var(--cyan)">$1</strong></div>')
    .replace(/^- /gm, '• ')
    .replace(/\n/g, '<br/>')
}
