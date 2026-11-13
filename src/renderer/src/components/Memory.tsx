import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { mdToHtml } from '../lib/markdown'

interface Hit { path: string; title: string; snippet: string }
export interface MemoryRequest { id: number; query?: string; path?: string }
type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export default function Memory({ compact = false, initialRequest, refreshToken, onCapture, onAsk, onOpenGraph, onOpenSource }: {
  compact?: boolean; initialRequest?: MemoryRequest; refreshToken?: number; onCapture?: () => void;
  onAsk?: (prompt: string) => void; onOpenGraph?: () => void; onOpenSource?: (path: string) => void
}) {
  const fieldId = useId()
  const [query, setQuery] = useState(initialRequest?.query ?? '')
  const [hits, setHits] = useState<Hit[]>([])
  const [state, setState] = useState<LoadState>('idle')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [visibleCount, setVisibleCount] = useState(50)
  const [selected, setSelected] = useState<string | null>(initialRequest?.path ?? null)
  const [content, setContent] = useState('')
  const [fileState, setFileState] = useState<LoadState>('idle')
  const [fileRetry, setFileRetry] = useState(0)
  const [raw, setRaw] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [claim, setClaim] = useState('')
  const [correction, setCorrection] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [correctionError, setCorrectionError] = useState('')
  const requestRef = useRef(0)
  const saveRef = useRef(false)
  const drafts = useRef<Record<string, { claim: string; correction: string; open: boolean }>>({})
  const loadedPath = useRef<string | null>(null)
  const appliedRequest = useRef<number>()
  const changeDraft = (patch: Partial<{ claim: string; correction: string; open: boolean }>) => {
    if (!selected) return
    const next = { claim, correction, open: correcting, ...patch }
    drafts.current[selected] = next
    setClaim(next.claim); setCorrection(next.correction); setCorrecting(next.open)
  }

  useEffect(() => {
    if (!initialRequest || saving || appliedRequest.current === initialRequest.id) return
    appliedRequest.current = initialRequest.id
    setQuery(initialRequest.query ?? ''); setSelected(initialRequest.path ?? null)
  }, [initialRequest?.id, saving])

  useEffect(() => {
    let cancelled = false
    const request = ++requestRef.current
    const term = query.trim()
    setHits([]); setNotice(''); setState('loading'); setVisibleCount(50)
    const handle = setTimeout(async () => {
      try {
        let next: Hit[] = []
        let nextNotice = ''
        if (term.length >= 2) {
          const result = await window.sb.brainSearch(term)
          if (result?.error) throw new Error('Search failed')
          const pack = Array.isArray(result) ? { hits: result, notice: '' } : result
          if (!pack || !Array.isArray(pack.hits) || pack.hits.some((hit: Hit) => typeof hit?.path !== 'string')) throw new Error('Invalid search result')
          next = pack.hits; nextNotice = pack.notice ?? ''
        } else if (!compact && !term) {
          const files = await window.sb.brainListMemory()
          if (!Array.isArray(files)) throw new Error('Invalid memory index')
          next = files.filter((f: { path: string }) => f.path.endsWith('.md')).map((f: { path: string; content: string }) => ({
            path: f.path, title: f.content.match(/^#\s+(.+)$/m)?.[1] ?? f.path.split('/').at(-1) ?? f.path,
            snippet: f.content.replace(/^---[\s\S]*?---\s*/, '').replace(/^#+\s.*$/gm, '').trim().slice(0, 180)
          }))
        }
        if (cancelled || request !== requestRef.current) return
        setHits(next); setNotice(nextNotice); setState('ready')
      } catch {
        if (cancelled || request !== requestRef.current) return
        setHits([]); setState('error')
      }
    }, term ? 180 : 0)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [query, retry, compact, refreshToken])

  useEffect(() => {
    const draft = selected ? drafts.current[selected] : undefined
    setClaim(draft?.claim ?? ''); setCorrection(draft?.correction ?? ''); setCorrecting(draft?.open ?? false)
    setFeedback(''); setCorrectionError('')
  }, [selected])

  useEffect(() => {
    let cancelled = false
    if (!selected) { loadedPath.current = null; setFileState('idle'); return }
    if (loadedPath.current !== selected) { setContent(''); setRaw(false); setFileState('loading') }
    loadedPath.current = selected
    window.sb.brainMemoryFile(selected).then(value => {
      if (cancelled) return
      if (typeof value !== 'string') { setContent(''); setFileState('error'); return }
      setContent(value); setFileState('ready')
    }).catch(() => { if (!cancelled) { setContent(''); setFileState('error') } })
    return () => { cancelled = true }
  }, [selected, fileRetry, refreshToken])

  const correct = useCallback(async () => {
    if (saveRef.current || claim.trim().length < 3 || correction.trim().length < 3) return
    saveRef.current = true; setSaving(true); setCorrectionError('')
    try {
      const result = await window.sb.brainCorrect(claim.trim(), correction.trim())
      if (result === false || (result && typeof result === 'object' && result.error)) throw new Error('Correction failed')
      setFeedback('Correção registrada na memória ativa. O histórico foi preservado.')
      if (selected) delete drafts.current[selected]
      setCorrecting(false); setClaim(''); setCorrection(''); setRetry(r => r + 1)
    } catch (error) {
      const code = String((error as Error)?.message ?? error)
      setCorrectionError(code.includes('CORRECTION_NEEDS_FACT') ? 'Não encontrei esse trecho entre os fatos ativos. Copie o texto completo de um fato ativo para substituí-lo. Para uma informação nova, use Capturar.' : code.includes('CORRECTION_AMBIGUOUS') ? 'O trecho contém mais de um fato ativo. Escolha apenas o fato que deseja substituir.' : 'Não foi possível registrar a correção. Os textos foram mantidos para você tentar novamente.')
    }
    finally { saveRef.current = false; setSaving(false) }
  }, [claim, correction, selected])

  const hasQuery = query.trim().length >= 2
  return <div className={compact ? 'memory-browser memory-browser--compact' : 'view memory-browser'}>
    {!compact && <div className="view-head"><div><div className="hud-tag">Seu conhecimento</div><h1>Memória</h1><p className="dim">Encontre o que você guardou e confira a fonte completa.</p></div><div className="actions"><button className="btn btn--ghost" onClick={onOpenGraph}>Explorar conexões</button><button className="btn btn--primary" onClick={onCapture}>Capturar</button></div></div>}
    <label className="field memory-search" htmlFor={fieldId}><span>{compact ? 'Buscar na memória' : 'O que você quer encontrar?'}</span><input id={fieldId} disabled={saving} data-autofocus={compact ? '' : undefined} type="search" value={query} onChange={e => { setQuery(e.target.value); setSelected(null) }} placeholder="Busque um assunto ou pergunte o que era válido em uma data…" /></label>
    {notice && <p className="feedback" role="status">{notice}</p>}
    <div className={`memory-layout${selected ? ' has-selection' : ''}`}>
      <section className="memory-results" aria-label="Resultados da memória" aria-busy={state === 'loading'}>
        {state === 'loading' && <p className="dim" role="status">{hasQuery ? 'Buscando na memória…' : 'Carregando…'}</p>}
        {state === 'error' && <div className="feedback feedback--error" role="alert"><p>A memória não pôde ser consultada. Isso não significa que ela esteja vazia.</p><button className="btn btn--sm" onClick={() => setRetry(r => r + 1)}>Tentar novamente</button></div>}
        {state === 'ready' && !hits.length && <div className="memory-empty"><p>{hasQuery ? 'Nenhuma memória encontrada para essa busca.' : compact ? 'Digite pelo menos duas letras para buscar.' : query ? 'Digite pelo menos duas letras para buscar.' : 'Sua memória começa com uma primeira ideia.'}</p><p className="dim">{hasQuery ? 'Tente outro termo ou guarde o contexto que está faltando.' : 'Você pode guardar um fato, um objetivo ou uma ideia.'}</p><button className="btn btn--ghost btn--sm" onClick={onCapture}>Capturar uma ideia</button></div>}
        {state === 'ready' && hits.length > 0 && <p className="memory-count dim" role="status">{hits.length} {hasQuery ? 'resultado(s)' : 'arquivo(s) disponíveis'}</p>}
        {hits.slice(0, visibleCount).map((hit, i) => <button className={`memory-result${selected === hit.path ? ' is-selected' : ''}`} key={`${hit.path}-${i}`} onClick={() => setSelected(hit.path)} aria-pressed={selected === hit.path} disabled={saving}><strong>{hit.title || hit.path}</strong>{hit.snippet && <span className="dim">{hit.snippet}</span>}<small>{hit.path}</small></button>)}
        {hits.length > visibleCount && <button className="btn btn--ghost" onClick={() => setVisibleCount(n => n + 50)}>Mostrar mais ({hits.length - visibleCount} restantes)</button>}
      </section>
      {selected && <section className="memory-source" aria-label="Fonte completa" aria-busy={fileState === 'loading'}>
        <header><button className="btn btn--ghost btn--sm" onClick={() => setSelected(null)} disabled={saving}>← Resultados</button><span className="memory-path">{selected}</span></header>
        {fileState === 'loading' && <p role="status">Abrindo a fonte…</p>}
        {fileState === 'error' && <div className="feedback feedback--error" role="alert"><p>Esta fonte está indisponível ou sem permissão de leitura.</p><button className="btn btn--sm" onClick={() => setFileRetry(n => n + 1)}>Tentar abrir novamente</button></div>}
        {fileState === 'ready' && <>
          <div className="memory-source__actions"><button className="btn btn--ghost btn--sm" onClick={() => setRaw(v => !v)} aria-pressed={raw}>{raw ? 'Leitura' : 'Texto original'}</button>{compact && <button className="btn btn--ghost btn--sm" onClick={() => onOpenSource?.(selected)}>Abrir na Memória</button>}<button className="btn btn--ghost btn--sm" disabled={saving} onClick={() => onAsk?.(`O que a fonte ${selected} diz sobre este assunto? Cite os trechos usados e sinalize informações que não estejam confirmadas.`)}>Perguntar sobre esta fonte</button>{!compact && !((window as any).__KEEPMIND_CORP__) && <button className="btn btn--ghost btn--sm" disabled={saving} onClick={() => changeDraft({ open: !correcting, claim: claim || window.getSelection()?.toString().trim() || '' })} aria-expanded={correcting}>Corrigir um fato</button>}</div>
          <p className="memory-source__hint dim">Fonte original completa. O arquivo pode conter propostas e histórico; confira os estados e as datas antes de usar.</p>
          {feedback && <p className="feedback" role="status">{feedback}</p>}
          {correcting && <form className="memory-correction" onSubmit={e => { e.preventDefault(); void correct() }}><h3>Registrar uma correção</h3><p className="dim">Copie o texto completo de um único fato ativo. Ele será substituído pela informação correta e preservado no histórico. Outros documentos continuam como fontes originais.</p><label className="field"><span>Fato a corrigir</span><textarea value={claim} disabled={saving} onChange={e => changeDraft({ claim: e.target.value })} minLength={3} required placeholder="Cole o texto completo do fato ativo" /></label><label className="field"><span>Informação correta</span><textarea value={correction} disabled={saving} onChange={e => changeDraft({ correction: e.target.value })} minLength={3} required /></label>{correctionError && <p className="feedback feedback--error" role="alert">{correctionError}</p>}<button className="btn btn--primary" disabled={saving || claim.trim().length < 3 || correction.trim().length < 3}>{saving ? 'Registrando…' : 'Salvar correção'}</button></form>}
          {raw ? <pre className="source-text">{content || 'Este arquivo está vazio.'}</pre> : <div className="source-reading" dangerouslySetInnerHTML={{ __html: mdToHtml(content || 'Este arquivo está vazio.') }} />}
        </>}
      </section>}
    </div>
  </div>
}
