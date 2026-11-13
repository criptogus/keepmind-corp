import { FormEvent, useEffect, useState } from 'react'

type RecordItem = Record<string, any>
const relationship: Record<string, string> = { possible_contradiction: 'Possível contradição', temporal_change: 'Mudança ao longo do tempo', complementary: 'Complementar', uncertain: 'Indeterminado' }
const states: Record<string, string> = { proposed: 'Proposta', confirmed: 'Confirmada', dismissed: 'Descartada', none: 'Sem evidência', limited: 'Evidência limitada', supported: 'Com evidência' }

export default function ProjectAnalysis({ project, onRefresh, onReview, onBusyChange }: { project: RecordItem; onRefresh: () => Promise<void>; onReview: (action: string, args: RecordItem) => Promise<boolean>; onBusyChange: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [context, setContext] = useState<RecordItem | null>(null)
  const [selected, setSelected] = useState<{ reportId: string; findingId: string; status: string } | null>(null)
  const [reason, setReason] = useState('')
  const api = window.sb as any
  useEffect(() => {
    let active = true
    setContext(null); setError('')
    api.continuity('context', { projectId: project.id }).then((result: RecordItem) => { if (active) setContext(result) }).catch((e: Error) => { if (active) setError(e.message || 'Não foi possível carregar o estado da análise.') })
    return () => { active = false }
  }, [project.id, project.revision])
  const analyze = async () => {
    setBusy(true); onBusyChange(true); setError('')
    try {
      if (!api.projectAnalyze) throw new Error('A análise semântica não está disponível nesta instalação.')
      await api.projectAnalyze({ projectId: project.id, expectedRevision: project.revision })
      await onRefresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false); onBusyChange(false) }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selected) return
    setBusy(true)
    try { if (await onReview('review_analysis', { ...selected, reason })) { setSelected(null); setReason('') } } finally { setBusy(false) }
  }
  return <section className="card card-pad">
    <div className="continuity-section-head"><div><h2>Análise de continuidade</h2><p className="dim">Compare decisões e resultados com as fontes disponíveis. As relações sugeridas precisam da sua revisão.</p></div><button className="btn btn--sm" disabled={busy} onClick={analyze}>{busy ? 'Analisando…' : 'Analisar fontes'}</button></div>
    {error && <p role="alert">Não foi possível concluir a análise ou verificar seu estado: {error}</p>}
    {!context && !error && <p className="dim">Verificando estado das análises…</p>}
    {(project.analysisReports ?? []).length === 0 && <p className="dim">Nenhuma análise registrada.</p>}
    {[...(project.analysisReports ?? [])].reverse().map((report: RecordItem) => {
      const state = context?.analysisReports?.find((r: RecordItem) => r.id === report.id)
      return <article className="continuity-record" key={report.id}>
        <p><strong>Análise de {new Date(report.createdAt).toLocaleString('pt-BR')}</strong> · {state ? state.stale ? 'Desatualizada: fontes ou projeto mudaram' : 'Atual' : 'Estado ainda não verificado'}</p>
        {(state?.sourceEvidence === 'none' || report.sourceEvidence === 'none') && <p className="dim">Esta análise não recebeu fontes de memória.</p>}{(state?.sourceUnavailable || report.sourceUnavailable) && <p role="status">Fonte indisponível; detalhes da análise não podem ser exibidos. Verifique a fonte antes de revisar.</p>}{report.summary && <p>{report.summary}</p>}{(report.provider || report.model) && <p className="dim">Modelo: {[report.provider, report.model].filter(Boolean).join(' / ')}</p>}
        {(report.sources ?? []).map((source: RecordItem) => <p className="dim" key={source.path}>Fonte: {source.path}</p>)}
        {(report.findings ?? []).length === 0 && <p className="dim">Nenhuma relação foi proposta nesta análise. Isso não comprova ausência de conflito.</p>}
        {(report.findings ?? []).map((finding: RecordItem) => <div className="continuity-record" key={finding.id}>
          <p><strong>{relationship[finding.relationship] ?? 'Relação indeterminada'}</strong> · {states[finding.status] ?? finding.status}</p>
          <p>Decisão: {project.decisions?.find((d: RecordItem) => d.id === finding.decisionId)?.choice ?? 'Indisponível'}</p>
          <p>{finding.explanation}</p><p>Fonte: {finding.sourcePath}</p>{finding.quote && <blockquote>{finding.quote}</blockquote>}
          {(finding.reviews ?? []).map((review: RecordItem, i: number) => <p className="dim" key={i}>Revisão: {states[review.status] ?? review.status} · {review.reason}</p>)}
          {finding.status === 'proposed' && state && !state.stale && !state.sourceUnavailable && <div className="continuity-actions"><button className="btn btn--ghost btn--sm" onClick={() => { setSelected({ reportId: report.id, findingId: finding.id, status: 'confirmed' }); setReason('') }}>Confirmar</button><button className="btn btn--ghost btn--sm" onClick={() => { setSelected({ reportId: report.id, findingId: finding.id, status: 'dismissed' }); setReason('') }}>Descartar</button></div>}
          {selected?.findingId === finding.id && <form className="continuity-form" onSubmit={submit}><label className="field"><span>Motivo da revisão</span><textarea required value={reason} onChange={e => setReason(e.target.value)} /></label><div className="continuity-actions"><button className="btn btn--sm" disabled={busy}>Salvar revisão</button><button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelected(null)}>Cancelar</button></div></form>}
        </div>)}
        {(report.outcomeAssessments ?? []).map((assessment: RecordItem) => <div className="continuity-record" key={assessment.outcomeId}><p><strong>Resultado:</strong> {project.outcomes?.find((o: RecordItem) => o.id === assessment.outcomeId)?.observedResult ?? 'Indisponível'}</p><p>{assessment.comparison}</p><p>{states[assessment.evidenceLevel] ?? 'Evidência indeterminada'} · causalidade não estabelecida</p>{assessment.sourcePath && <p>Fonte: {assessment.sourcePath}</p>}{assessment.quote && <blockquote>{assessment.quote}</blockquote>}</div>)}
      </article>
    })}
  </section>
}
