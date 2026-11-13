import { useCallback, useEffect, useState } from 'react'
import './projects.css'

type Case = { id: string; status: 'pass' | 'fail' | 'inconclusive'; answer: string; reason: string; evidence: string[]; citations: { sourceId: string; valid: boolean }[]; judgment: string; checks: Record<string, boolean>; sourceEvidence?: { sourceId: string; quote: string }[]; expected?: string; source?: string; expectedResult?: string; sources?: string[] }
type Report = { id: string; suiteVersion: string; suiteFingerprint?: string; provider: string; model: string; startedAt: string; finishedAt: string; status: string; calls: number; cases: Case[]; suiteCases?: { id: string; question: string; sources: { id: string; text: string }[]; criterion: string; requiredSources: string[] }[] }
const labels: Record<string, string> = { pass: 'Passou', fail: 'Falhou', inconclusive: 'Inconclusivo', completed: 'Concluído', cancelled: 'Cancelado', budget_exhausted: 'Limite de chamadas atingido', model_judged: 'Avaliado por modelo', not_judged: 'Sem avaliação por modelo' }
export default function AnswerBenchmark({ space }: { space?: string } = {}) {
  const [reports, setReports] = useState<Report[]>([])
  const [selected, setSelected] = useState('')
  const [compare, setCompare] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ completed: number; total: number; calls: number } | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState(false)
  const api = window.sb as any
  const refresh = useCallback(async () => {
    if (!api.answerBenchmarkList) throw new Error('Benchmark indisponível nesta instalação.')
    try {
      const result: Report[] = await api.answerBenchmarkList()
      setListError(false); setReports(result); setSelected(current => current || result[0]?.id || '')
    } catch (e) { setListError(true); throw e }
  }, [api])
  useEffect(() => { refresh().catch(e => { setListError(true); setError(e.message || 'Não foi possível carregar o histórico.') }).finally(() => setLoading(false)) }, [refresh])
  useEffect(() => { const unsubscribe = api.onBenchmarkProgress?.((update: { completed: number; total: number; calls: number; space?: string }) => { if (!space || !update.space || update.space === space) setProgress(update) }); return () => { unsubscribe?.() } }, [api, space])
  const run = async () => {
    setProgress(null); setRunning(true); setError('')
    try {
      if (!api.answerBenchmarkRun) throw new Error('Benchmark indisponível nesta instalação.')
      const report: Report = await api.answerBenchmarkRun()
      setSelected(report.id); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setRunning(false); setCanceling(false) }
  }
  const cancel = async () => { setCanceling(true); setError(''); try { if (!await api.answerBenchmarkCancel()) setError('Não há execução ativa para cancelar.') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setCanceling(false) } }
  const report = reports.find(r => r.id === selected)
  const compatible = (a: Report, b: Report) => !!a.suiteFingerprint && a.suiteFingerprint === b.suiteFingerprint && a.suiteVersion === b.suiteVersion && a.cases.length === b.cases.length && a.cases.every((c, i) => c.id === b.cases[i]?.id)
  const comparables = report ? reports.filter(r => r.id !== report.id && compatible(r, report)) : []
  const baseline = report && reports.find(r => r.id === compare && compatible(r, report))
  return <div className="view continuity"><div className="view-head"><div><div className="hud-tag">AVALIAÇÃO</div><h1>Qualidade das respostas</h1><p className="dim">O modelo configurado responde e avalia seis casos sintéticos, com até 12 chamadas. Confira as justificativas e fontes: o julgamento do modelo pode estar errado ou ser inconclusivo.</p></div></div>
    <div className="continuity-actions"><button className="btn btn--primary btn--sm" disabled={running} onClick={run}>{running ? 'Executando…' : 'Rodar benchmark'}</button>{running && <button className="btn btn--ghost btn--sm" disabled={canceling} onClick={cancel}>{canceling ? 'Cancelando…' : 'Cancelar execução'}</button>}</div>
    {running && <p role="status" className="dim">{progress ? `${progress.completed} de ${progress.total} casos concluídos · ${progress.calls} chamadas` : 'Iniciando avaliação…'}</p>}
    {error && <div className="continuity-notice continuity-notice--error" role="alert">{error}</div>}
    {loading ? <p className="dim">Carregando histórico…</p> : reports.length === 0 && listError ? null : reports.length === 0 ? <div className="card card-pad"><p className="dim">Nenhuma execução registrada. Execute quando quiser avaliar o modelo atual.</p></div> : <>
      <div className="card card-pad continuity-form"><label className="field"><span>Execução</span><select value={selected} onChange={e => { setSelected(e.target.value); setCompare('') }}>{reports.map(r => <option key={r.id} value={r.id}>{new Date(r.startedAt).toLocaleString('pt-BR')} · {r.model} · {r.suiteVersion}</option>)}</select></label>
      {report && <><p><strong>{labels[report.status] ?? report.status}</strong> · {report.provider} / {report.model} · suíte {report.suiteVersion} · {report.calls} chamadas</p><label className="field"><span>Comparar com execução da mesma suíte</span><select value={compare} onChange={e => setCompare(e.target.value)}><option value="">Não comparar</option>{comparables.map(r => <option key={r.id} value={r.id}>{new Date(r.startedAt).toLocaleString('pt-BR')} · {r.model}</option>)}</select></label>{comparables.length === 0 && <p className="dim">Nenhuma execução comparável: a comparação exige mesma versão e identificação da suíte e os mesmos casos na mesma ordem.</p>}<p><strong>Casos registrados:</strong> {report.cases.filter(c => c.status === 'pass').length} passaram · {report.cases.filter(c => c.status === 'fail').length} falharam · {report.cases.filter(c => c.status === 'inconclusive').length} inconclusivos</p></>}</div>
      {report?.cases.map(item => { const previous = baseline?.cases.find(c => c.id === item.id); const scenario = report.suiteCases?.find(c => c.id === item.id); return <details className="card card-pad continuity-benchmark-case" key={item.id}><summary>{item.id} · {labels[item.status]}</summary>{previous && <p>Comparação: {labels[previous.status]} → {labels[item.status]}</p>}{scenario && <><p><strong>Pergunta:</strong> {scenario.question}</p><p><strong>Resultado esperado:</strong> {scenario.criterion}</p>{scenario.sources.map(source => <p key={source.id}><strong>Fonte sintética {source.id}:</strong> {source.text}</p>)}</>}<p><strong>Juízo:</strong> {labels[item.judgment] ?? item.judgment}</p><p><strong>Resposta observada:</strong> {item.answer || 'Nenhuma resposta'}</p><p><strong>Motivo:</strong> {item.reason}</p>{(item.expectedResult || item.expected) && <p><strong>Resultado esperado:</strong> {item.expectedResult || item.expected}</p>}{item.source && <p><strong>Fonte:</strong> {item.source}</p>}{(item.sources ?? []).map(source => <p key={source}><strong>Fonte:</strong> {source}</p>)}{(item.sourceEvidence ?? []).map((e, i) => <p key={i}><strong>Trecho da fonte {e.sourceId}:</strong> {e.quote}</p>)}{(item.evidence ?? []).map((e, i) => <p key={i}><strong>Evidência:</strong> {e}</p>)}{(item.citations ?? []).map((c, i) => <p key={i}><strong>Citação:</strong> {c.sourceId} · {c.valid ? 'Válida' : 'Inválida'}</p>)}</details> })}
    </>}
  </div>
}
