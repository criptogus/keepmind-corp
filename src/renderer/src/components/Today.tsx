import { useCallback, useEffect, useRef, useState } from 'react'

import { sourceLabel, updatedLabel } from '../lib/sourceLabels'
import { IconChat, IconDoc, IconSparkle } from './icons'

type View = 'projects' | 'chat' | 'graph' | 'automations' | 'connectors' | 'settings' | 'activity' | 'answer-benchmark' | 'relationships'
type Props = { refreshToken?: number; onToast?: (m: string, k?: 'info' | 'error' | 'success') => void; onNavigate?: (view: View, detail?: { projectId?: string; query?: string; path?: string; contactId?: string }) => void; onCapture?: () => void }
type Entry = { ts: string | number; verb: string; sentence: string; path?: string }
type Pending = { id: string; name: string; instruction: string }
type Fact = { id: string; text: string; since: string; origin: string; source: string; previous: string }
type Project = { id: string; title: string; objective?: string; nextStep?: string; status?: string; updatedAt?: string; error?: unknown; decisions?: { status?: string; reviewAt?: string; choice?: string; reviews?: { reviewedAt?: string }[] }[]; outcomes?: { lesson?: string; lessonConfirmed?: boolean; lessonReviews?: { status?: string }[] }[]; analysisReports?: { findings?: { status?: string }[] }[] }
type Data = { projects: Project[]; pending: Pending[]; facts: Fact[]; policy: { active: string; proposals: string[] } | null; ledger: Entry[]; health: any; sleeps: any[]; score: any }
const initial: Data = { projects: [], pending: [], facts: [], policy: null, ledger: [], health: null, sleeps: [], score: null }
const labels: Record<keyof Data, string> = { projects: 'projetos', pending: 'aprovações de automação', facts: 'propostas de fatos', policy: 'política', ledger: 'atividade', health: 'indicadores', sleeps: 'consolidação', score: 'verificações' }

export default function Today({ onToast, onNavigate, onCapture, refreshToken }: Props) {
  const [crm, setCrm] = useState<any>(null)
  const [crmError, setCrmError] = useState(false)
  const [crmLoading, setCrmLoading] = useState(false)
  const crmSequence = useRef(0)
  const loadCrm = useCallback(async () => {
    if (typeof (window.sb as any).crm !== 'function') return
    const seq = ++crmSequence.current; setCrmLoading(true); setCrmError(false)
    try { const result = await (window.sb as any).crm('snapshot', { board: 'personal' }); if (result?.error) throw new Error(String(result.error)); if (seq === crmSequence.current) setCrm(result) }
    catch { if (seq === crmSequence.current) { setCrm(null); setCrmError(true) } }
    finally { if (seq === crmSequence.current) setCrmLoading(false) }
  }, [])
  useEffect(() => { void loadCrm() }, [loadCrm, refreshToken])
  const [data, setData] = useState<Data>(initial)
  const [errors, setErrors] = useState<Partial<Record<keyof Data, string>>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const mutation = useRef(false)
  const loadSequence = useRef(0)
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    const tasks: { [K in keyof Data]: () => Promise<any> } = {
      projects: async () => { const result = await window.sb.continuity('list'); if (result?.error) throw new Error(String(result.error)); return Array.isArray(result) ? result : result?.projects ?? [] },
      pending: () => window.sb.automationPending(), facts: () => window.sb.brainFacts(), policy: () => window.sb.brainPolicy(),
      ledger: () => window.sb.brainLedger(40), health: () => window.sb.brainHealth(), sleeps: () => window.sb.brainListSleep(), score: () => window.sb.brainEval()
    }
    const keys = Object.keys(tasks) as (keyof Data)[]
    const results = await Promise.allSettled(keys.map(key => Promise.resolve().then(tasks[key])))
    if (sequence !== loadSequence.current) return
    setData(previous => {
      const next = { ...previous }
      results.forEach((result, i) => { (next as any)[keys[i]] = result.status === 'fulfilled' ? result.value ?? initial[keys[i]] : initial[keys[i]] })
      return next
    })
    const failed: Partial<Record<keyof Data, string>> = {}
    results.forEach((result, i) => { if (result.status === 'rejected') failed[keys[i]] = String(result.reason?.message ?? result.reason) })
    setErrors(failed); setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load, refreshToken])
  useEffect(() => { const off = window.sb.onJob?.(() => { void load() }); return () => { off?.() } }, [load])
  const act = async (operation: () => Promise<unknown>, success: string) => {
    if (mutation.current) return
    mutation.current = true; setBusy(true)
    try { const result = await operation(); if (result === false) throw new Error('Não foi possível concluir a ação.'); if (result && typeof result === 'object' && 'error' in result && result.error) throw new Error(String(result.error)); onToast?.(typeof result === 'string' ? result : success, 'success'); await load() }
    catch (e) { onToast?.(String((e as Error)?.message ?? e), 'error'); await load() }
    finally { mutation.current = false; setBusy(false) }
  }
  const projects = data.projects.filter(p => !p.error && (!p.status || p.status === 'active')).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  const project = projects[0]
  const reviews = projects.flatMap(p => [
    ...(p.decisions ?? []).filter(d => d.status === 'proposed').map(d => ({ project: p, text: `Decisão proposta: ${d.choice ?? 'decisão'}` })),
    ...(p.decisions ?? []).filter(d => d.reviewAt && d.reviewAt <= new Date().toISOString().slice(0, 10) && !['proposed', 'superseded', 'rejected'].includes(d.status ?? '') && !(d.reviews ?? []).some(r => r.reviewedAt && r.reviewedAt.slice(0, 10) >= d.reviewAt!)).map(d => ({ project: p, text: `Revisar decisão: ${d.choice ?? 'decisão'}` })),
    ...((p.analysisReports ?? []).some(report => report.findings?.some(finding => finding.status === 'proposed')) ? [{ project: p, text: 'Relações sugeridas pela análise aguardam sua revisão.' }] : []),
    ...(p.outcomes ?? []).filter(o => o.lesson && !o.lessonConfirmed && o.lessonReviews?.at(-1)?.status !== 'rejected').map(o => ({ project: p, text: `Revisar lição: ${o.lesson}` }))
  ])
  const decisions = reviews.length + data.pending.length + data.facts.length + (data.policy?.proposals?.length ? 1 : 0)
  const decisionFailed = !!(errors.pending || errors.facts || errors.policy || errors.projects || data.projects.some(p => p.error))
  const health = data.health?.stats
  return <div className="view">
    <div className="view-head"><div><div className="hud-tag" style={{ marginBottom: 6 }}>HOJE</div><h1>Continue de onde parou</h1><p className="dim" style={{ marginTop: 6 }}>Seu próximo passo, decisões pendentes e resultados recentes em um só lugar.</p></div></div>
    {Object.keys(errors).length > 0 && <div className="card card-pad" role="alert" style={{ marginBottom: 18 }}><strong>Algumas informações não puderam ser carregadas</strong><p className="dim">Indisponível: {(Object.keys(errors) as (keyof Data)[]).map(key => labels[key]).join(', ')}.</p><button className="btn btn--ghost btn--sm" onClick={() => { setLoading(true); void load() }}>Tentar novamente</button></div>}
    {data.projects.some(p => p.error) && <div className="card card-pad" role="alert" style={{ marginBottom: 18 }}>Um ou mais projetos estão indisponíveis. Os demais continuam acessíveis em Projetos.</div>}
    <section className="value-actions" aria-label="O que você quer fazer agora?">
      <button className="value-action" onClick={onCapture}><IconDoc /><span><strong>Guardar uma ideia</strong><small>Uma decisão, promessa ou algo para lembrar.</small></span></button>
      <button className="value-action" onClick={() => onNavigate?.('chat', { query: 'O que posso retomar a partir da minha memória? Cite as fontes e diferencie decisões confirmadas de propostas.' })}><IconChat /><span><strong>Encontrar contexto</strong><small>Prepare uma pergunta e confira as fontes.</small></span></button>
      <button className="value-action" onClick={() => onNavigate?.('relationships')}><IconSparkle /><span><strong>Preparar um acompanhamento</strong><small>Reveja conversas e próximos contatos.</small></span></button>
    </section>
    <section style={{ marginBottom: 22 }}><div className="section-heading"><h2>Retome seus projetos</h2><button className="btn btn--ghost btn--sm" onClick={() => onNavigate?.('projects')}>Ver todos os projetos</button></div>
      {loading && !project ? <p className="dim" role="status">Carregando projetos…</p> : project ? <div className="resume-grid">{projects.slice(0, 3).map(project => <div key={project.id} className="card card-pad resume-card"><h3>{project.title}</h3><p className="dim" style={{ marginTop: 8 }}><strong>Objetivo:</strong> {project.objective || 'Ainda não definido'}</p><p style={{ marginTop: 6 }}><strong>Próximo passo:</strong> {project.nextStep || 'Ainda não definido'}</p><button className="btn btn--primary btn--sm" style={{ marginTop: 12 }} onClick={() => onNavigate?.('projects', { projectId: project.id })}>Retomar projeto</button><small className="dim">{updatedLabel(project.updatedAt)}</small></div>)}</div> : !errors.projects && !data.projects.some(p => p.error) && <div className="card card-pad"><h2>Comece com algo que importa</h2><p className="dim" style={{ margin: '8px 0 12px' }}>Registre uma ideia ou crie um projeto para ter um próximo passo à mão.</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn btn--primary btn--sm" onClick={onCapture}>Fazer primeira captura</button><button className="btn btn--ghost btn--sm" onClick={() => onNavigate?.('projects')}>Criar projeto</button></div></div>}
    </section>
    <section style={{ marginBottom: 22 }}><div className="hud-tag" style={{ marginBottom: 10 }}>PRECISA DE VOCÊ</div>
      {reviews.map((r, i) => <div className="card card-pad" key={`${r.project.id}-${i}`} style={{ marginBottom: 10 }}><h2>{r.project.title}</h2><p className="dim">{r.text}</p><button className="btn btn--ghost btn--sm" onClick={() => onNavigate?.('projects', { projectId: r.project.id })}>Abrir revisão</button></div>)}
      {data.pending.map(p => <div className="card card-pad" key={p.id} style={{ marginBottom: 10 }}><h2>{p.name}</h2><p className="dim" style={{ margin: '6px 0 10px' }}>{p.instruction}</p><div style={{ display: 'flex', gap: 6 }}><button disabled={busy} className="btn btn--primary btn--sm" onClick={() => void act(() => window.sb.automationApprove(p.id), 'Automação aprovada.')}>Aprovar</button><button disabled={busy} className="btn btn--ghost btn--sm" onClick={() => void act(() => window.sb.automationReject(p.id), 'Automação recusada.')}>Recusar</button></div></div>)}
      {data.facts.map(f => <div className="card card-pad" key={f.id} style={{ marginBottom: 10 }}><h2>Fato proposto</h2><p style={{ marginTop: 6 }}>{f.text}</p><p className="faint" style={{ margin: '5px 0 10px' }}>{[f.since, f.origin, f.source].filter(Boolean).join(' · ')}</p>{f.previous && <p className="dim">Substitui: {f.previous}</p>}<div style={{ display: 'flex', gap: 6 }}><button disabled={busy} className="btn btn--primary btn--sm" onClick={() => void act(() => window.sb.brainFactAccept(f.id), 'Fato aceito.')}>Aceitar</button><button disabled={busy} className="btn btn--ghost btn--sm" onClick={() => void act(() => window.sb.brainFactDiscard(f.id), 'Proposta descartada.')}>Descartar</button></div></div>)}
      {!!data.policy?.proposals?.length && <div className="card card-pad" style={{ marginBottom: 10 }}><h2>Proposta de política</h2><p className="dim">Atual: {data.policy.active}</p><p>{data.policy.proposals[data.policy.proposals.length - 1]}</p><button disabled={busy} className="btn btn--primary btn--sm" style={{ marginTop: 10 }} onClick={() => void act(() => window.sb.brainPolicyApply(), 'Política aplicada.')}>Aplicar proposta</button></div>}
      {!loading && !decisions && !decisionFailed && <p className="dim">Nenhuma decisão pendente agora.</p>}
    </section>
    {(crm || crmError || crmLoading) && <section style={{ marginBottom: 22 }}><div className="hud-tag" style={{ marginBottom: 10 }}>RELACIONAMENTOS</div><div className="card card-pad"><h2>Próximos contatos</h2>{crmLoading ? <p className="dim">Carregando…</p> : crmError ? <><p className="dim">Não foi possível carregar os acompanhamentos.</p><button className="btn btn--ghost btn--sm" onClick={() => void loadCrm()}>Tentar novamente</button></> : <>{(crm?.insights ?? []).slice(0, 3).map((item: any, i: number) => <div key={`${item.type}-${i}`} style={{ marginTop: 10 }}><p>{item.text}</p>{item.contactId && <button className="btn btn--ghost btn--sm" onClick={() => onNavigate?.('relationships', { contactId: item.contactId })}>Ver contexto</button>}</div>)}{!crm?.insights?.length && <p className="dim">Nenhum acompanhamento pendente agora.</p>}<button className="btn btn--ghost btn--sm" style={{ marginTop: 10 }} onClick={() => onNavigate?.('relationships')}>Abrir relacionamentos</button></>}</div></section>}
    <section style={{ marginBottom: 22 }}><div className="hud-tag" style={{ marginBottom: 10 }}>RESULTADOS RECENTES</div>
      {data.ledger.length > 0 ? <div className="card">{data.ledger.slice(0, 8).map((e, i) => <div className="note-row" key={`${e.ts}-${i}`} style={{ cursor: 'default', flexWrap: 'wrap' }}><span className="note-row__title">{e.sentence}</span><span className="faint">{new Date(e.ts).toLocaleString('pt-BR')}{e.path ? ` · Fonte: ${sourceLabel(e.path)}` : ''}</span>{e.path && <button className="btn btn--ghost btn--sm" onClick={() => onNavigate?.('graph', { path: e.path })}>Consultar fonte</button>}</div>)}</div> : !loading && !errors.ledger && <div className="card card-pad"><p className="dim">Os resultados aparecerão aqui quando houver atividade.</p><button className="btn btn--ghost btn--sm" style={{ marginTop: 10 }} onClick={onCapture}>Registrar uma ideia</button></div>}
    </section>
    <details><summary className="dim" style={{ cursor: 'pointer' }}>Indicadores e diagnóstico</summary><div className="card card-pad" style={{ marginTop: 10 }}><p className="dim">Eventos recentes: {errors.ledger ? 'indisponível' : data.ledger.length} · Escritas em 7 dias: {health?.writes7d ?? '—'} · Arquivos: {health?.mdFiles ?? '—'} · Automações: {health ? `${health.automationsEnabled}/${health.automationsTotal}` : '—'}</p>{data.sleeps[0] && <p className="dim">Última consolidação: {data.sleeps[0].date}</p>}{data.score?.last && <p className="dim">Verificações de recuperação: {data.score.last.hit}/{data.score.last.total}</p>}<button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={() => onNavigate?.('activity')}>Ver atividade</button></div></details>
  </div>
}
