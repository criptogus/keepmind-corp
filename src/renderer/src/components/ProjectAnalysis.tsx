import { FormEvent, useEffect, useRef, useState } from 'react'

type RecordItem = Record<string, any>
const relationship: Record<string, string> = { possible_contradiction: 'Possível contradição', temporal_change: 'Mudança ao longo do tempo', complementary: 'Complementar', uncertain: 'Indeterminado' }
const states: Record<string, string> = { proposed: 'Proposta', confirmed: 'Confirmada', dismissed: 'Descartada', none: 'Sem evidência', limited: 'Evidência limitada', supported: 'Com evidência' }

export default function ProjectAnalysis({ project, onRefresh, onReview, onBusyChange }: { project: RecordItem; onRefresh: () => Promise<void>; onReview: (action: string, args: RecordItem) => Promise<boolean>; onBusyChange: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [context, setContext] = useState<RecordItem | null>(null)
  const [selected, setSelected] = useState<{ reportId: string; findingId: string; status: string } | null>(null)
  const [reason, setReason] = useState('')
  const reasons = useRef<Record<string, string>>({})
  const working = useRef(false)
  const choose = (reportId: string, findingId: string, status: string) => { setSelected({ reportId, findingId, status }); setReason(reasons.current[`${reportId}:${findingId}:${status}`] ?? '') }
  const api = window.sb as any
  useEffect(() => {
    let active = true
    setContext(null); setError('')
    api.continuity('context', { projectId: project.id }).then((result: RecordItem) => { if (result?.error) throw new Error(typeof result.error === 'string' ? result.error : result.error.message); if (active) setContext(result) }).catch((e: Error) => { if (active) setError(e.message || 'Não foi possível carregar o estado da análise.') })
    return () => { active = false }
  }, [project.id, project.revision])
  const analyze = async () => {
    if (working.current) return
    working.current = true; setBusy(true); onBusyChange(true); setError('')
    try {
      if (!api.projectAnalyze) throw new Error('A análise semântica não está disponível nesta instalação.')
      await api.projectAnalyze({ projectId: project.id, expectedRevision: project.revision })
      await onRefresh()
    } catch (e) { const message = e instanceof Error ? e.message : String(e); setError(message.includes('STALE_ANALYSIS') ? 'O projeto ou as fontes mudaram durante a análise. Atualize o projeto e tente novamente.' : message) } finally { working.current = false; setBusy(false); onBusyChange(false) }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selected || working.current) return
    working.current = true; setBusy(true)
    try { if (await onReview('review_analysis', { ...selected, reason })) { delete reasons.current[`${selected.reportId}:${selected.findingId}:${selected.status}`]; setSelected(null); setReason('') } } finally { working.current = false; setBusy(false) }
  }
  return <section className="card card-pad">
    <div className="continuity-section-head"><div><h2>Análise de continuidade</h2><p className="dim">Compare decisões e resultados com as fontes disponíveis. As relações sugeridas precisam da sua revisão.</p></div><button className="btn btn--sm" disabled={busy} onClick={analyze}>{busy ? 'Analisando…' : 'Analisar fontes'}</button></div>
    {error && <p role="alert">Não foi possível concluir a análise ou verificar seu estado: {error}</p>}
    {!context && !error && <p className="dim">Verificando estado das análises…</p>}
    {(project.analysisReports ?? []).length === 0 && <p className="dim">Nenhuma análise registrada.</p>}
    {[...(project.analysisReports ?? [])].reverse().map((report: RecordItem) => {
      const state = context?.analysisReports?.find((r: RecordItem) => r.id === report.id)
      return <details className="continuity-record" key={report.id}>
        <summary>Análise de {new Date(report.createdAt).toLocaleString('pt-BR')} · {state ? state.stale ? 'Desatualizada: fontes ou projeto mudaram' : 'Atual' : 'Estado ainda não verificado'}</summary>
        {state?.stale && <p><button className="btn btn--sm" disabled={busy} onClick={analyze}>Atualizar análise</button></p>}
        {(state?.sourceEvidence === 'none' || report.sourceEvidence === 'none') && <p className="dim">Esta análise não recebeu fontes de memória.</p>}{(state?.sourceUnavailable || report.sourceUnavailable) && <p role="status">Fonte indisponível; detalhes da análise não podem ser exibidos. Verifique a fonte antes de revisar.</p>}{!state?.sourceUnavailable && !report.sourceUnavailable && report.summary && <p>{report.summary}</p>}{(report.provider || report.model) && <p className="dim">Modelo: {[report.provider, report.model].filter(Boolean).join(' / ')}</p>}
        {(report.sources ?? []).map((source: RecordItem) => <p className="dim" key={source.path}>Fonte: {source.path}</p>)}
        {(report.findings ?? []).length === 0 && <p className="dim">Nenhuma relação foi proposta nesta análise. Isso não comprova ausência de conflito.</p>}
        {!state?.sourceUnavailable && !report.sourceUnavailable && (report.findings ?? []).map((finding: RecordItem) => <div className="continuity-record" key={finding.id}>
          <p><strong>{relationship[finding.relationship] ?? 'Relação indeterminada'}</strong> · {states[finding.status] ?? finding.status}</p>
          <p>Decisão: {project.decisions?.find((d: RecordItem) => d.id === finding.decisionId)?.choice ?? 'Indisponível'}</p>
          <p>{finding.explanation}</p><p>Fonte: {finding.sourcePath}</p>{finding.quote && <blockquote>{finding.quote}</blockquote>}
          {(finding.reviews ?? []).map((review: RecordItem, i: number) => <p className="dim" key={i}>Revisão: {states[review.status] ?? review.status} · {review.reason}</p>)}
          {finding.status === 'proposed' && state && !state.stale && !state.sourceUnavailable && !report.sourceUnavailable && <div className="continuity-actions"><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => choose(report.id, finding.id, 'confirmed')}>Confirmar</button><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => choose(report.id, finding.id, 'dismissed')}>Descartar</button></div>}
          {selected?.findingId === finding.id && state && !state.stale && !state.sourceUnavailable && !report.sourceUnavailable && <form className="continuity-form" onSubmit={submit}><label className="field"><span>Motivo da revisão</span><textarea required disabled={busy} value={reason} onChange={e => { setReason(e.target.value); if (selected) reasons.current[`${selected.reportId}:${selected.findingId}:${selected.status}`] = e.target.value }} /></label><div className="continuity-actions"><button className="btn btn--sm" disabled={busy}>Salvar revisão</button><button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setSelected(null)}>Cancelar</button></div></form>}
        </div>)}
        {!state?.sourceUnavailable && !report.sourceUnavailable && (report.outcomeAssessments ?? []).map((assessment: RecordItem) => <div className="continuity-record" key={assessment.outcomeId}><p><strong>Resultado:</strong> {project.outcomes?.find((o: RecordItem) => o.id === assessment.outcomeId)?.observedResult ?? 'Indisponível'}</p><p>{assessment.comparison}</p><p>{states[assessment.evidenceLevel] ?? 'Evidência indeterminada'} · causalidade não estabelecida</p>{assessment.sourcePath && <p>Fonte: {assessment.sourcePath}</p>}{assessment.quote && <blockquote>{assessment.quote}</blockquote>}</div>)}
      </details>
    })}
  </section>
}
