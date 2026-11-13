import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import './projects.css'
import ProjectAnalysis from './ProjectAnalysis'

type Project = Record<string, any>
type Field = { name: string; label: string; required?: boolean; type?: string; hint?: string }
const fields: Record<string, Field[]> = {
  create: [
    { name: 'title', label: 'Nome do projeto', required: true },
    { name: 'objective', label: 'Objetivo', required: true },
    { name: 'successCriteria', label: 'Como saberemos que deu certo?' },
    { name: 'nextStep', label: 'Próximo passo' }
  ],
  update: [
    { name: 'title', label: 'Nome do projeto', required: true }, { name: 'objective', label: 'Objetivo', required: true },
    { name: 'successCriteria', label: 'Critério de sucesso' }, { name: 'nextStep', label: 'Próximo passo' }
  ],
  add_decision: [
    { name: 'choice', label: 'Decisão', required: true }, { name: 'rationale', label: 'Por quê?' },
    { name: 'alternatives', label: 'Alternativas consideradas', hint: 'Uma por linha.' }, { name: 'rejectionReason', label: 'Por que descartar as alternativas?' },
    { name: 'assumptions', label: 'Premissas', hint: 'Uma por linha.' }, { name: 'expectedOutcome', label: 'Resultado esperado' },
    { name: 'reviewAt', label: 'Revisar em', type: 'date' }, { name: 'evidence', label: 'Caminhos de evidência', hint: 'Caminhos de memória, um por linha.' }
  ],
  add_attempt: [
    { name: 'approach', label: 'Tentativa ou abordagem descartada', required: true },
    { name: 'result', label: 'Resultado' }, { name: 'reason', label: 'Por que foi descartada?' }, { name: 'applicability', label: 'Quando ainda poderia servir?' }
  ],
  add_artifact: [
    { name: 'label', label: 'Artefato', required: true }, { name: 'path', label: 'Caminho de memória (.md)', required: true },
    { name: 'evidence', label: 'Caminhos de evidência', hint: 'Um por linha.' }
  ],
  record_outcome: [
    { name: 'observedResult', label: 'Resultado observado', required: true },
    { name: 'evidence', label: 'Caminhos de evidência', hint: 'Um por linha.' },
    { name: 'lesson', label: 'Lição confirmada por você', hint: 'Registre somente uma conclusão que você confirma.' }
  ],
  add_question: [{ name: 'question', label: 'Questão em aberto', required: true }, { name: 'reason', label: 'Por que importa?' }]

}

async function findSources(query: string) {
  const [result, security] = await Promise.all([window.sb.brainSearch(query), window.sb.memorySecurityStatus()])
  if (!result) throw new Error('Não foi possível buscar fontes.')
  if (result?.error) throw new Error(typeof result.error === 'string' ? result.error : result.error.message || 'Não foi possível buscar fontes.')
  if (security?.error) throw new Error(typeof security.error === 'string' ? security.error : security.error.message || 'Não foi possível verificar o espaço ativo.')
  const active = security?.space
  if (!active) throw new Error('Não foi possível verificar o espaço ativo.')
  const current = await window.sb.memorySecurityStatus()
  if (current?.error || current?.space !== active) throw new Error('O espaço ativo mudou durante a busca. Busque novamente.')
  const hits = Array.isArray(result) ? result : result?.hits ?? []
  if (!Array.isArray(hits)) throw new Error('Resposta de busca inválida.')
  return { notice: result?.notice || '', hits: hits.flatMap((hit: any) => {
    if (typeof hit?.path !== 'string') return []
    const match = /^spaces\/([^/]+)\/(.+)$/.exec(hit.path)
    const path = match ? (match[1] === active ? match[2] : '') : active === 'personal' ? hit.path : ''
    return path && path.endsWith('.md') ? [{ ...hit, path }] : []
  }) }
}

function SourcePicker({ disabled, onPick }: { disabled: boolean; onPick: (path: string) => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Project[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const search = async () => {
    const id = ++generation.current; setSearching(true); setHits([]); setNotice(''); setError('')
    try {
      const result = await findSources(query)
      if (generation.current !== id) return
      setHits(result.hits); setNotice(result.notice || (result.hits.length ? '' : 'Nenhuma fonte encontrada neste espaço.'))
    } catch (e) { if (generation.current === id) setError(prettyError(e)) }
    finally { if (generation.current === id) setSearching(false) }
  }
  return <div className="continuity-source"><label className="field"><span>Buscar memória</span><input value={query} disabled={disabled} onChange={e => { generation.current++; setSearching(false); setHits([]); setNotice(''); setError(''); setQuery(e.target.value) }} /></label><button type="button" className="btn btn--sm" onClick={search} disabled={disabled || searching || query.trim().length < 2}>{searching ? 'Buscando…' : 'Buscar fonte'}</button>{notice && <p className="dim" role="status">{notice}</p>}{error && <p role="alert">{error}</p>}{hits.map(hit => <div className="continuity-hit" key={hit.path}><button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => onPick(hit.path)}>Selecionar</button><span>{hit.title || hit.path}<small className="dim">{hit.path}</small>{hit.snippet && <small className="dim">{hit.snippet}</small>}</span></div>)}</div>
}

function Editor({ action, onSubmit, busy, onCancel, initial, decisions, children, onDraft }:  { children?: ReactNode; onDraft?: (values: Record<string, string>) => void; action: string; onSubmit: (values: Record<string, string>) => Promise<boolean>; busy: boolean; onCancel?: () => void; initial?: Record<string, string>; decisions?: Project[] }) {
  const [values, setValues] = useState<Record<string, string>>(initial ?? {})
  const submitting = useRef(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || submitting.current) return
    submitting.current = true
    try { if (await onSubmit(values)) { setValues({}); onCancel?.() } } finally { submitting.current = false }
  }
  const change = (next: Record<string, string>) => { setValues(next); onDraft?.(next) }
  const renderField = (field: Field) => <label className="field" key={field.name}>
      <span>{field.label}</span>
      {field.type === 'date' ? <input type="date" disabled={busy} value={values[field.name] ?? ''} onChange={e => change({ ...values, [field.name]: e.target.value })} /> :
        <textarea disabled={busy} rows={field.name === 'title' ? 1 : 2} required={field.required} value={values[field.name] ?? ''} onChange={e => change({ ...values, [field.name]: e.target.value })} />}
      {field.hint && <small className="dim">{field.hint}</small>}
    </label>
  const primary = fields[action].filter((_, i) => action === 'create' ? i < 2 : action === 'add_decision' ? i < 2 : true)
  const advanced = fields[action].filter(field => !primary.includes(field))
  return <form className="continuity-form" onSubmit={submit}>
    {primary.map(renderField)}
    {(action === 'add_artifact' || action === 'add_decision') && <details><summary>{action === 'add_artifact' ? 'Buscar artefato na memória' : 'Adicionar fonte da memória'}</summary><SourcePicker disabled={busy} onPick={path => change(action === 'add_artifact' ? { ...values, path } : { ...values, evidence: [...new Set([...(values.evidence ?? '').split('\n').filter(Boolean), path])].join('\n') })} /></details>}
    {advanced.length > 0 && <details><summary>{action === 'create' ? 'Detalhes opcionais' : 'Mais detalhes (opcional)'}</summary><div className="continuity-form continuity-disclosure">{advanced.map(renderField)}</div></details>}
    {children}
    {action === 'update' && <label className="field"><span>Estado do projeto</span><select disabled={busy} value={values.status ?? 'active'} onChange={e => change({ ...values, status: e.target.value })}><option value="active">Ativo</option><option value="paused">Pausado</option><option value="completed">Concluído</option><option value="archived">Arquivado</option></select></label>}
    {action === 'add_artifact' && <fieldset><legend>Decisões relacionadas</legend>{(decisions ?? []).length === 0 && <p className="dim">Nenhuma decisão registrada.</p>}{(decisions ?? []).map(d => <label className="continuity-hit" key={d.id}><input disabled={busy} type="checkbox" checked={(values.decisionIds ?? '').split('\n').includes(d.id)} onChange={e => { const ids = (values.decisionIds ?? '').split('\n').filter(Boolean); change({ ...values, decisionIds: (e.target.checked ? [...ids, d.id] : ids.filter(id => id !== d.id)).join('\n') }) }} />{d.choice}</label>)}</fieldset>}
    {action === 'record_outcome' && <><label className="field"><span>Decisão relacionada</span><select disabled={busy} required value={values.decisionId ?? ''} onChange={e => change({ ...values, decisionId: e.target.value })}><option value="">Selecione uma decisão</option>{(decisions ?? []).map(d => <option key={d.id} value={d.id}>{d.choice}</option>)}</select></label><label className="field"><span>Estado da execução</span><select disabled={busy} required value={values.executionStatus ?? ''} onChange={e => change({ ...values, executionStatus: e.target.value })}><option value="">Selecione</option><option value="planned">Planejada</option><option value="in_progress">Em andamento</option><option value="completed">Concluída</option><option value="failed">Falhou</option><option value="cancelled">Cancelada</option><option value="unknown">Desconhecida</option></select></label></>}
    {action === 'add_question' && <label className="field"><span>Prioridade</span><select disabled={busy} value={values.priority ?? 'medium'} onChange={e => change({ ...values, priority: e.target.value })}><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option></select></label>}
    <div className="continuity-actions"><button className="btn btn--primary btn--sm" disabled={busy} type="submit">{busy ? 'Salvando…' : 'Salvar'}</button>{onCancel && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onCancel}>Cancelar</button>}</div>
  </form>
}

function prettyError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error || 'Não foi possível concluir a operação.')
  if (text.includes('REVISION_CONFLICT')) return 'Este projeto mudou em outra sessão. Volte à lista e abra-o novamente antes de salvar.'
  if (text.includes('STALE_ANALYSIS')) return 'A análise ficou desatualizada porque o projeto ou as fontes mudaram. Atualize o projeto e execute a análise novamente antes de revisar.'
  if (text.includes('EVIDENCE_UNAVAILABLE')) return 'Uma fonte não está disponível neste espaço. Confira os caminhos selecionados.'
  if (text.includes('EVIDENCE_PATH_DENIED') || text.includes('ARTIFACT_PATH_DENIED')) return 'Um caminho não é permitido. Use um caminho de memória .md autorizado.'
  return text
}
function suggestedQuestion(question: string) {
  return ({ 'What is the project objective?': 'Qual é o objetivo do projeto?', 'How will success be assessed?': 'Como o sucesso será avaliado?', 'What result is expected from this decision?': 'Qual resultado é esperado desta decisão?', 'How should the changed or unavailable evidence affect this decision?': 'Como a evidência alterada ou indisponível deve afetar esta decisão?', 'What is the next step?': 'Qual é o próximo passo?' } as Record<string, string>)[question] ?? question
}
function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(display).join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return value == null ? '' : String(value)
}

function latest(items: Project[] = []) { return [...items].sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))[0] }

const statusText: Record<string, string> = { active: 'Ativo', paused: 'Pausado', completed: 'Concluído', archived: 'Arquivado', proposed: 'Proposta', accepted: 'Aceita', rejected: 'Rejeitada', superseded: 'Superada', open: 'Em aberto', resolved: 'Resolvida', high: 'Alta', medium: 'Média', low: 'Baixa', planned: 'Planejada', in_progress: 'Em andamento', failed: 'Falhou', cancelled: 'Cancelada', unknown: 'Desconhecida', verified: 'Verificada', changed: 'Alterada', unavailable: 'Indisponível' }
function RecordDetails({ kind, item, project, check }: { kind: string; item: Project; project: Project; check: any }) {
  const line = (label: string, value: any) => value != null && value !== '' && (!Array.isArray(value) || value.length > 0) ? <p key={label}><strong>{label}:</strong> {Array.isArray(value) ? value.join(', ') : value}</p> : null
  const choice = (id: string) => project.decisions?.find((d: Project) => d.id === id)?.choice ?? 'Decisão indisponível'
  return <>
    {kind === 'decisions' && <>{line('Decisão', item.choice)}{line('Estado', statusText[item.status] ?? item.status)}{line('Motivo', item.rationale)}{line('Alternativas', item.alternatives)}{line('Motivo do descarte', item.rejectionReason)}{line('Premissas', item.assumptions)}{line('Resultado esperado', item.expectedOutcome)}{line('Revisar em', item.reviewAt)}{(item.reviews ?? []).map((r: any, i: number) => <p key={i}><strong>Revisão:</strong> {statusText[r.status] ?? r.status} · {r.reason}{r.reviewedAt ? ` · ${new Date(r.reviewedAt).toLocaleDateString('pt-BR')}` : ''}</p>)}</>}
    {kind === 'attempts' && <>{line('Abordagem', item.approach)}{line('Resultado', item.result)}{line('Motivo', item.reason)}{line('Aplicabilidade', item.applicability)}</>}
    {kind === 'artifacts' && <>{line('Artefato', item.label)}{line('Caminho', item.path)}{line('Decisões relacionadas', (item.decisionIds ?? []).map(choice))}</>}
    {kind === 'outcomes' && <>{line('Decisão relacionada', choice(item.decisionId))}{line('Execução', statusText[item.executionStatus] ?? item.executionStatus)}{line('Resultado observado', item.observedResult)}{line(item.lessonConfirmed ? 'Lição confirmada' : item.lessonReviews?.at(-1)?.status === 'rejected' ? 'Lição rejeitada' : 'Lição proposta', item.lesson)}{(item.lessonReviews ?? []).map((review: any, i: number) => <p key={i}><strong>Revisão da lição:</strong> {review.status === 'confirmed' ? 'Confirmada' : 'Rejeitada'} · {review.reason}</p>)}</>}
    {kind === 'questions' && <>{line('Questão', item.question)}{line('Motivo', item.reason)}{line('Prioridade', statusText[item.priority] ?? item.priority)}{line('Estado', statusText[item.status] ?? item.status)}{line('Resolução', item.resolution)}</>}
    {(item.evidence ?? []).map((e: any) => { const state = check?.evidence?.find((x: any) => x.itemId === item.id && x.path === e.path); return <p key={e.path}><strong>Fonte:</strong> {e.path} <span className="dim">· {state ? statusText[state.status] ?? state.status : 'Estado ainda não verificado'}</span></p> })}
  </>
}

export default function Projects({ unsupported, initialProjectId, initialProjectRequest, onResume }: { unsupported?: boolean; initialProjectId?: string; initialProjectRequest?: number; onResume?: (text: string) => void }) {
  const [list, setList] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editor, setEditor] = useState('')
  const [packet, setPacket] = useState('')
  const [handoff, setHandoff] = useState<Project | null>(null)
  const [missingQuestion, setMissingQuestion] = useState<any>(null)
  const [check, setCheck] = useState<any>(null)
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceHits, setSourceHits] = useState<any[]>([])
  const [sourceSearched, setSourceSearched] = useState(false)
  const [sourceNotice, setSourceNotice] = useState('')
  const [searching, setSearching] = useState(false)
  const searchGeneration = useRef(0)
  const mutationInFlight = useRef(false)
  const drafts = useRef<Record<string, Record<string, string>>>({})
  const [sources, setSources] = useState<string[]>([])
  const draftKey = (action: string) => `${project?.id ?? 'new'}:${action}`
  const [inline, setInline] = useState<{ action: string; id: string; status?: string } | null>(null)
  const [reason, setReason] = useState('')
  const reviewDrafts = useRef<Record<string, string>>({})
  const reviewKey = (item: { action: string; id: string; status?: string }) => `${project?.id}:${item.action}:${item.id}:${item.status ?? ''}`
  const chooseReview = (item: { action: string; id: string; status?: string }) => { setInline(item); setReason(reviewDrafts.current[reviewKey(item)] ?? '') }
  const api = (window.sb as any).continuity as ((action: string, args?: Record<string, unknown>) => Promise<any>) | undefined
  const call = useCallback(async (action: string, args: Record<string, unknown> = {}) => {
    if (!api) throw new Error('Continuidade não está disponível nesta instalação.')
    const result = await api(action, args)
    if (result?.error) throw new Error(typeof result.error === 'string' ? result.error : result.error.message || 'Operação não concluída.')
    return result
  }, [api])
  const loadList = useCallback(async () => {
    const result = await call('list')
    setList(Array.isArray(result) ? result : result?.projects ?? [])
  }, [call])
  useEffect(() => {
    if (unsupported || !api) { setLoading(false); return }
    setLoading(true); loadList().catch(e => setError(prettyError(e))).finally(() => setLoading(false))
  }, [unsupported, api, loadList])
  const open = async (id: string) => {
    searchGeneration.current++; setSearching(false); setSourceHits([]); setSourceSearched(false)
    setBusy(true); setError(''); setMessage(''); setPacket(''); setMissingQuestion(null); setCheck(null); setEditor(''); setInline(null); setReason('')
    try { setProject(await call('get', { projectId: id })) } catch (e) { setError(prettyError(e)) } finally { setBusy(false) }
  }
  useEffect(() => { if (!unsupported && api && initialProjectId) void open(initialProjectId) }, [initialProjectId, initialProjectRequest, unsupported, api])
  const mutate = async (action: string, values: Record<string, any>) => {
    if (mutationInFlight.current) return false
    mutationInFlight.current = true
    setBusy(true); setError(''); setMessage('')
    try {
      const normalized: Record<string, any> = action === 'create' ? { successCriteria: '', nextStep: '', ...values } : { ...values }
      for (const key of ['evidence', 'assumptions', 'alternatives', 'decisionIds']) if (typeof normalized[key] === 'string') normalized[key] = normalized[key].split('\n').map((v: string) => v.trim()).filter(Boolean)
      if (action === 'record_outcome') normalized.lessonConfirmed = !!normalized.lesson?.trim()
      const args = action === 'create' ? { ...normalized, evidence: sources } : { projectId: project?.id, expectedRevision: project?.revision, ...normalized }
      const result = await call(action, args)
      if (action === 'create') { setProject(result); setSources([]) }
      else if (result?.id) setProject(result)
      else if (project) setProject(await call('get', { projectId: project.id }))
      delete drafts.current[draftKey(action)]
      if (inline && inline.action === action) delete reviewDrafts.current[reviewKey(inline)]
      setPacket(''); setMissingQuestion(null); setCheck(null); setInline(null); setReason('')
      try { await loadList(); setMessage('Salvo.') }
      catch (e) { setError(`O registro foi salvo, mas a lista não pôde ser atualizada: ${prettyError(e)}`) }
      return true
    } catch (e) { setError(prettyError(e)); return false } finally { mutationInFlight.current = false; setBusy(false) }
  }
  const run = async (action: string) => {
    if (!project) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await call(action, { projectId: project.id })
      if (action === 'context') { setHandoff(typeof result === 'object' ? result : null); setPacket(typeof result === 'string' ? result : result.text || JSON.stringify(result, null, 2)); setMissingQuestion(result?.missingQuestion ?? null) }
      else setCheck(result)
    } catch (e) { setError(prettyError(e)) } finally { setBusy(false) }
  }
  const search = async () => {
    if (searching || busy) return
    const id = ++searchGeneration.current
    setSearching(true); setError(''); setSourceSearched(false); setSourceNotice(''); setSourceHits([])
    try { const result = await findSources(sourceQuery); if (id !== searchGeneration.current) return; setSourceNotice(result.notice); setSourceHits(result.hits); setSourceSearched(true) }
    catch (e) { if (id === searchGeneration.current) setError(prettyError(e)) }
    finally { if (id === searchGeneration.current) setSearching(false) }
  }

  if (unsupported || !api) return <div className="view"><div className="view-head"><div><div className="hud-tag">CONTINUIDADE</div><h1>Projetos</h1><p className="dim">A continuidade de projetos não está disponível nesta edição ou instalação.</p></div></div></div>
  return <div className="view continuity">
    <div className="view-head"><div><div className="hud-tag">CONTINUIDADE</div><h1>Projetos</h1><p className="dim">Retome o trabalho com decisões, evidências e próximos passos em contexto.</p></div></div>
    {error && <div className="continuity-notice continuity-notice--error" role="alert">{error} <button className="btn btn--ghost btn--sm" onClick={() => setError('')}>Fechar</button></div>}
    {message && <div className="continuity-notice" role="status">{message}</div>}
    {loading ? <p className="dim">Carregando projetos…</p> : !project ? <>
      {list.length > 0 && <div className="continuity-list">{list.map(item => item.error ? <div className="card card-pad continuity-project" role="alert" key={item.id}><strong>Projeto indisponível</strong><span className="dim">Este registro está corrompido ({item.id}). Os demais projetos continuam disponíveis.</span></div> : <button className="card card-pad continuity-project" key={item.id} onClick={() => open(item.id)} disabled={busy}><strong>{item.title}</strong><span className="dim">{item.nextStep || item.objective}</span></button>)}</div>}
      <div className="card card-pad"><h2>{list.length ? 'Novo projeto' : 'Comece pelo seu primeiro projeto'}</h2><p className="dim">Comece com um nome e um objetivo. Você pode completar o restante depois.</p>
        <Editor action="create" initial={drafts.current[draftKey('create')]} onDraft={v => { drafts.current[draftKey('create')] = v }} busy={busy} onSubmit={values => mutate('create', values)}>
          <details className="continuity-source"><summary>Fontes de memória (opcional){sources.length > 0 ? ` · ${sources.length} selecionada(s)` : ''}</summary><p className="dim">Busque fontes do espaço ativo. Resultados de outros espaços são omitidos.</p>
            <div className="continuity-actions"><label className="sr-only" htmlFor="source-search">Buscar memória</label><input id="source-search" value={sourceQuery} disabled={busy} onChange={e => { searchGeneration.current++; setSearching(false); setSourceHits([]); setSourceNotice(''); setSourceSearched(false); setSourceQuery(e.target.value) }} placeholder="Buscar memória" /><button type="button" className="btn btn--sm" onClick={search} disabled={busy || searching || sourceQuery.trim().length < 2}>{searching ? 'Buscando…' : 'Buscar'}</button></div>
            {sourceNotice && <p className="dim" role="status">{sourceNotice}</p>}{sourceSearched && sourceHits.length === 0 && <p className="dim">Nenhuma fonte encontrada neste espaço.</p>}
            {sourceHits.map(hit => <label className="continuity-hit" key={hit.path}><input disabled={busy} type="checkbox" checked={sources.includes(hit.path)} onChange={e => setSources(e.target.checked ? [...sources, hit.path] : sources.filter(p => p !== hit.path))} /><span>{hit.title || hit.path}<small className="dim">{hit.path}</small>{hit.snippet && <small className="dim">{hit.snippet}</small>}</span></label>)}
            {sources.length > 0 && <p className="dim">Selecionadas: {sources.join(', ')}</p>}
          </details>
        </Editor>
      </div>
    </> : <>
      <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { setProject(null); setEditor(''); setError(''); loadList().catch(e => setError(prettyError(e))) }}>← Todos os projetos</button>
      <div className="card card-pad continuity-overview"><div><h2>{project.title}</h2><p>{project.objective}</p><p><strong>Onde parou:</strong> {latest(project.outcomes)?.observedResult || 'Nenhum resultado registrado.'}</p><p><strong>Registro mais recente:</strong> {latest(project.decisions) ? `Última decisão registrada: ${latest(project.decisions).choice}` : 'Nenhuma decisão registrada ainda.'}</p><p><strong>Próximo passo:</strong> {project.nextStep || 'Ainda não definido.'}</p><p><strong>Sucesso:</strong> {display(project.successCriteria) || 'Ainda não definido.'}</p><p><strong>Estado:</strong> {statusText[project.status] ?? project.status}</p>{(project.evidence ?? []).map((e: any) => { const state = check?.evidence?.find((x: any) => x.kind === 'project' && x.path === e.path); return <p key={e.path}><strong>Fonte:</strong> {e.path} <span className="dim">· {state ? statusText[state.status] ?? state.status : 'Estado ainda não verificado'}</span></p> })}{(() => { const q = (project.questions ?? []).filter((x: any) => x.status === 'open').sort((a: any, b: any) => ({ high: 0, medium: 1, low: 2 }[a.priority as 'high' | 'medium' | 'low'] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority as 'high' | 'medium' | 'low'] ?? 1))[0]; return q ? <p><strong>Questão prioritária:</strong> {q.question}</p> : null })()}</div><div className="continuity-actions"><button className="btn btn--primary btn--sm" disabled={busy} onClick={() => run('context')}>Retomar contexto</button><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run('check')}>Verificar fontes</button><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setEditor(editor === 'update' ? '' : 'update')}>Editar projeto</button></div></div>
      {editor === 'update' && <section className="card card-pad"><h2>Editar projeto</h2><Editor action="update" onDraft={v => { drafts.current[draftKey('update')] = v }} initial={drafts.current[draftKey('update')] ?? { title: project.title, objective: project.objective, successCriteria: display(project.successCriteria), nextStep: project.nextStep, status: project.status }} busy={busy} onSubmit={values => mutate('update', values)} onCancel={() => { delete drafts.current[draftKey(editor)]; setEditor('') }} /></section>}
      {missingQuestion && <section className="card card-pad"><h2>Pergunta sugerida</h2><p>{suggestedQuestion(missingQuestion.question)}</p><div className="continuity-actions"><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => mutate('feedback', { interventionId: missingQuestion.interventionId, value: 'useful' })}>Foi útil</button><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => mutate('feedback', { interventionId: missingQuestion.interventionId, value: 'not_useful' })}>Não foi útil</button><button className="btn btn--ghost btn--sm" disabled={busy} onClick={async () => { if (await mutate('feedback', { interventionId: missingQuestion.interventionId, value: 'resolved' })) setMissingQuestion(null) }}>Resolvida</button></div></section>}
      {packet && <section className="card card-pad"><h2>Contexto para retomar</h2><div className="continuity-handoff"><p><strong>Objetivo:</strong> {handoff?.objective || project.objective || 'Não definido.'}</p><p><strong>Próximo passo:</strong> {handoff?.nextStep || 'Não definido.'}</p><p><strong>Decisões aceitas:</strong> {handoff?.acceptedDecisions?.map((d: Project) => d.choice).join('; ') || 'Nenhuma registrada.'}</p><p><strong>Questões em aberto:</strong> {handoff?.openQuestions?.map((q: Project) => q.question).join('; ') || 'Nenhuma registrada.'}</p><p className="dim">Revise o texto completo para conferir fontes, propostas e histórico antes de compartilhá-lo.</p></div><details><summary>Ver texto original</summary><pre className="continuity-packet">{packet}</pre></details>{onResume && <><button className="btn btn--primary btn--sm" disabled={busy || packet.length > 100000} onClick={() => onResume(packet)}>Usar na conversa</button>{packet.length > 100000 && <p className="dim">O contexto completo excede o limite da conversa. Copie e selecione os trechos necessários.</p>}</>}<button className="btn btn--sm" onClick={async () => { try { await navigator.clipboard.writeText(packet); setMessage('Contexto copiado.') } catch (e) { setError(prettyError(e)) } }}>Copiar contexto</button></section>}
      {check && <section className="card card-pad"><h2>Estado das fontes</h2>{!check.impacts?.length ? <p className="dim">Nenhuma fonte alterada ou indisponível.</p> : check.impacts.map((impact: any) => <article className="continuity-record" key={impact.interventionId}><p><strong>{impact.status === 'changed' ? 'Alterada' : 'Indisponível'}:</strong> {impact.path}</p><p className="dim">Afeta {impact.kind === 'project' ? `o projeto ${project.title}` : impact.kind === 'decision' ? `a decisão ${project.decisions?.find((d: any) => d.id === impact.itemId)?.choice ?? 'indisponível'}` : impact.kind === 'artifact' ? `o artefato ${project.artifacts?.find((a: any) => a.id === impact.itemId)?.label ?? 'indisponível'}` : impact.kind === 'outcome' ? `o resultado ${project.outcomes?.find((o: any) => o.id === impact.itemId)?.observedResult ?? 'indisponível'}` : 'um registro'}</p><div className="continuity-actions">{impact.status === 'changed' && <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { chooseReview({ action: 'acknowledge_evidence', id: impact.interventionId }) }}>Reconhecer alteração</button>}<button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => mutate('feedback', { interventionId: impact.interventionId, value: 'useful' })}>Foi útil</button><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => mutate('feedback', { interventionId: impact.interventionId, value: 'not_useful' })}>Não foi útil</button></div>{inline?.action === 'acknowledge_evidence' && inline.id === impact.interventionId && <form className="continuity-form" onSubmit={async e => { e.preventDefault(); if (await mutate('acknowledge_evidence', { interventionId: impact.interventionId, reason })) await run('check') }}><label className="field"><span>Motivo do reconhecimento</span><textarea required disabled={busy} value={reason} onChange={e => { setReason(e.target.value); if (inline) reviewDrafts.current[reviewKey(inline)] = e.target.value }} /></label><div className="continuity-actions"><button className="btn btn--sm" disabled={busy}>Confirmar</button><button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setInline(null)}>Cancelar</button></div></form>}</article>)}</section>}
      <ProjectAnalysis project={project} onRefresh={async () => { setProject(await call('get', { projectId: project.id })); await loadList() }} onReview={mutate} onBusyChange={setBusy} />
      <div className="continuity-grid">{[
        ['Decisões', 'decisions', 'add_decision'], ['Tentativas e abordagens', 'attempts', 'add_attempt'],
        ['Artefatos', 'artifacts', 'add_artifact'], ['Resultados e lições', 'outcomes', 'record_outcome'], ['Questões em aberto', 'questions', 'add_question']
      ].map(([label, key, action]) => <section className="card card-pad" key={key}><details><summary><span className="continuity-summary-title">{label}</span> <span className="dim">· {(project[key] ?? []).length}</span></summary><h2 className="sr-only">{label}</h2><div className="continuity-section-head"><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setEditor(editor === action ? '' : action)}>Adicionar</button></div>
        {editor === action && <Editor key={action} action={action} initial={drafts.current[draftKey(action)]} onDraft={v => { drafts.current[draftKey(action)] = v }} decisions={project.decisions} busy={busy} onSubmit={values => mutate(action, values)} onCancel={() => { delete drafts.current[draftKey(editor)]; setEditor('') }} />}
        {(project[key] ?? []).length === 0 ? <p className="dim">Nenhum registro ainda.</p> : (project[key] ?? []).map((item: any, index: number) => <article className="continuity-record" key={item.id ?? index}>
          <RecordDetails kind={key} item={item} project={project} check={check} />
          {key === 'decisions' && <div className="continuity-actions">{([['accepted', 'Aceitar'], ['rejected', 'Rejeitar'], ['superseded', 'Superar']] as const).filter(([status]) => status !== item.status && item.status !== 'superseded').map(([status, label]) => <button key={status} className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { chooseReview({ action: 'review_decision', id: item.id, status }) }}>{label}</button>)}</div>}
          {key === 'outcomes' && item.lesson && <div className="continuity-actions">{!item.lessonConfirmed && <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { chooseReview({ action: 'review_outcome_lesson', id: item.id, status: 'confirmed' }) }}>Confirmar lição</button>}{item.lessonReviews?.at(-1)?.status !== 'rejected' && <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { chooseReview({ action: 'review_outcome_lesson', id: item.id, status: 'rejected' }) }}>Rejeitar lição</button>}</div>}
          {key === 'questions' && item.status === 'open' && <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { chooseReview({ action: 'resolve_question', id: item.id }) }}>Marcar resolvida</button>}
          {inline && inline.id === item.id && ['review_decision', 'resolve_question', 'review_outcome_lesson'].includes(inline.action) && <form className="continuity-form" onSubmit={async e => { e.preventDefault(); await mutate(inline!.action, inline!.action === 'review_decision' ? { decisionId: item.id, status: inline!.status, reason } : inline!.action === 'review_outcome_lesson' ? { outcomeId: item.id, status: inline!.status, reason } : { questionId: item.id, resolution: reason }) }}><p>Você está {inline.action === 'resolve_question' ? 'resolvendo esta questão' : inline.action === 'review_decision' ? `alterando a decisão para ${statusText[inline.status ?? ''] ?? inline.status}` : `marcando a lição como ${statusText[inline.status ?? ''] ?? inline.status}`}. Confira as fontes e registre o motivo.</p><label className="field"><span>{inline.action === 'resolve_question' ? 'Resolução' : 'Motivo da revisão'}</span><textarea required disabled={busy} value={reason} onChange={e => { setReason(e.target.value); if (inline) reviewDrafts.current[reviewKey(inline)] = e.target.value }} /></label><div className="continuity-actions"><button className="btn btn--sm" disabled={busy}>Confirmar</button><button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setInline(null)}>Cancelar</button></div></form>}
        </article>)}
      </details></section>)}</div>

    </>}
  </div>
}
