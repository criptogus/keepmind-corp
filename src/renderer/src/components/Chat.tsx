import { useEffect, useRef, useState } from 'react'
import { IconSend } from './icons'
import { mdToHtml } from '../lib/markdown'
import KeepMindAvatar, { type KeepMindAvatarState } from './KeepMindAvatar'
import { useAppearance } from '../lib/appearance'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  steps?: string[]
  memories?: string[]
  saved?: string[]
  corrected?: boolean
  error?: boolean
  cancelled?: boolean
  retryText?: string
}

const STORE_KEY = 'sb-chat:brain'
const loadHistory = (key: string): Msg[] => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const list = JSON.parse(raw) as Msg[]
    return list.filter(m => m && typeof m.content === 'string' && !m.streaming).slice(-50)
  } catch { return [] }
}

interface ChatProps {
  onActivity?: () => void
  onOpenMemory?: (path: string) => void
  initialPrompt?: { id: number; text: string }
  active?: boolean
  sessionKey?: string
}
export default function Chat({ onActivity, onOpenMemory, initialPrompt, active = true, sessionKey = 'personal' }: ChatProps) {
  const storeKey = sessionKey === 'personal' ? STORE_KEY : `${STORE_KEY}:${encodeURIComponent(sessionKey)}`
  const [messages, setMessages] = useState<Msg[]>(() => loadHistory(storeKey))
  const [input, setInput] = useState('')
  const inputRef = useRef(input)
  inputRef.current = input
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [fixError, setFixError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const requestId = useRef<string | null>(null)
  const mounted = useRef(true)
  const receivedText = useRef('')
  const [avatarState, setAvatarState] = useState<KeepMindAvatarState>('idle')
  const { reducedMotion } = useAppearance()
  const happyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [fixing, setFixing] = useState<number | null>(null)
  const [fixText, setFixText] = useState('')
  const [fixClaim, setFixClaim] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (active) bottomRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [messages, active, reducedMotion])

  const offerPrompt = (text: string) => {
    if (inputRef.current.trim()) setPendingPrompt(text)
    else { setInput(text); taRef.current?.focus() }
  }
  useEffect(() => { if (initialPrompt) offerPrompt(initialPrompt.text) }, [initialPrompt?.id])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (happyTimer.current) clearTimeout(happyTimer.current)
      const id = requestId.current
      requestId.current = null
      if (id && typeof window.sb.brainCancel === 'function') void window.sb.brainCancel(id).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!messages.length || messages.some(m => m.streaming)) return
    try { localStorage.setItem(storeKey, JSON.stringify(messages.slice(-50))) } catch { /* quota */ }
  }, [messages, storeKey])

  useEffect(() => {
    unsubRef.current?.()
    const offDelta = window.sb.onBrainDelta((t, id) => {
      if (!requestId.current || (id !== requestId.current && (id !== undefined || typeof window.sb.brainCancel === 'function'))) return
      receivedText.current += t
      setMessages(prev => {
        const list = [...prev]
        const last = list[list.length - 1]
        if (last?.role === 'assistant' && last.streaming) {
          list[list.length - 1] = { ...last, content: last.content + t }
        }
        return list
      })
      onActivity?.()
    })
    const offStep = window.sb.onBrainStep((step, id) => {
      if (!requestId.current || (id !== requestId.current && (id !== undefined || typeof window.sb.brainCancel === 'function'))) return
      setMessages(prev => {
        const list = [...prev]
        const last = list[list.length - 1]
        if (last?.role === 'assistant' && last.streaming) {
          list[list.length - 1] = { ...last, steps: [...(last.steps ?? []), step] }
        }
        return list
      })
    })
    unsubRef.current = () => { offDelta?.(); offStep?.() }
    return () => unsubRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const correct = async (index: number) => {
    const claim = fixClaim.trim()
    const correction = fixText.trim()
    if (claim.length < 3 || correction.length < 3 || busy) return
    setFixError('')
    setBusy(true)
    try {
      await window.sb.brainCorrect(claim, correction)
      if (!mounted.current) return
      setMessages(prev => prev.map((m, i) => i === index ? { ...m, corrected: true } : m))
      setFixing(null)
      setFixText(''); setFixClaim('')
    } catch (e: any) {
      const detail = String(e?.code ?? '') + ' ' + String(e?.message ?? e)
      const message = detail.includes('CORRECTION_NEEDS_FACT')
        ? 'Não encontramos um fato ativo com esse texto. Consulte a fonte e cole o texto completo do fato; para guardar uma informação nova, use Capturar.'
        : detail.includes('CORRECTION_AMBIGUOUS')
          ? 'Há mais de um fato ativo com esse texto. Consulte a fonte para identificar e corrigir o registro desejado.'
          : e?.message || 'Não foi possível salvar a correção. Tente novamente.'
      if (mounted.current) setFixError(message)
    }
    finally { if (mounted.current) setBusy(false) }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'
    setBusy(true)
    if (happyTimer.current) clearTimeout(happyTimer.current)
    setAvatarState('thinking')
    const id = crypto.randomUUID()
    requestId.current = id
    receivedText.current = ''
    onActivity?.()

    setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true, steps: [] }])

    try {
      const result = await window.sb.brainChat('brain', text, id)
      if (!mounted.current || requestId.current !== id) return
      const resultText = typeof result === 'string' ? result : result?.text
      if (!resultText?.trim() && !receivedText.current.trim()) throw new Error('Empty response')
      setMessages(prev => {
        const list = [...prev]
        const last = list[list.length - 1]
        if (last?.role === 'assistant') {
          list[list.length - 1] = {
            ...last,
            streaming: false,
            content: (typeof result === 'string' && result.trim()) ? result : (typeof result?.text === 'string' && result.text.trim()) ? result.text : (last.content || ''),
            memories: result?.memories ?? last.memories,
            saved: result?.saved ?? last.saved,
            steps: result?.steps?.length ? result.steps : last.steps
          }
        }
        return list
      })
      setAvatarState('happy')
      happyTimer.current = setTimeout(() => setAvatarState('idle'), 1800)
    } catch (e: any) {
      if (!mounted.current || requestId.current !== id) return
      const cancelled = String(e?.message ?? e).includes('CHAT_CANCELLED')
      setAvatarState(cancelled ? 'idle' : 'error')
      setMessages(prev => {
        const list = [...prev]
        const last = list[list.length - 1]
        list[list.length - 1] = { ...last, role: 'assistant', content: last?.content || '', streaming: false, error: !cancelled, cancelled, retryText: text }
        return list
      })
    } finally {
      if (mounted.current && requestId.current === id) {
        requestId.current = null
        setCancelling(false)
        setBusy(false)
      }
    }
  }

  const cancel = async () => {
    const id = requestId.current
    if (!id || typeof window.sb.brainCancel !== 'function' || cancelling) return
    setCancelling(true)
    try { if (!await window.sb.brainCancel(id) && mounted.current && requestId.current === id) setCancelling(false) } catch { if (mounted.current && requestId.current === id) setCancelling(false) }
  }

  const copyMsg = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
  }

  return (
    <div className="chat-wrap">
      <div className="chat-main">
        <div className="chat-header">
          <KeepMindAvatar state={avatarState} active={active} size={48} />
          <div>
            <h3>KeepMind</h3>
            <div className="dim" style={{ fontSize: 13 }}>
              {cancelling ? 'Interrompendo…' : avatarState === 'thinking' ? 'Pensando…' : avatarState === 'error' ? 'Não foi possível concluir a resposta.' : 'Pergunte sobre sua memória.'}
            </div>
          </div>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="empty">
              <h3>Pergunte ao KeepMind</h3>
              <p>
                As respostas podem consultar sua memória. Quando disponíveis, as fontes e alterações aparecem abaixo da resposta.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role === 'user' ? 'msg--user' : ''}`}>
              <div className="msg__col">
                <div className="msg__who">{m.role === 'user' ? 'Você' : 'KeepMind'}</div>
                <div className="msg__bubble msg__body">
                  {m.streaming && !m.content ? (
                    <span role="status">Pensando…</span>
                  ) : (
                    <span dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} />
                  )}
                </div>
                {m.cancelled && <div role="status" style={{ marginTop: 8 }}>Geração interrompida. Ações já iniciadas podem terminar. <button className="msg__copy" onClick={() => offerPrompt(m.retryText ?? '')}>Recuperar mensagem</button></div>}
                {m.error && <div role="alert" style={{ marginTop: 8 }}>Não foi possível concluir a resposta. {m.content ? 'A resposta parcial está acima. ' : ''}<button className="msg__copy" onClick={() => offerPrompt(m.retryText ?? '')}>Recuperar mensagem para tentar novamente</button></div>}
                {m.role === 'assistant' && (m.steps?.length || m.memories?.length || m.saved?.length) ? (
                  <div className="msg__trace">
                    {m.steps?.map((s, n) => <div key={n}>{s}</div>)}
                    {!!m.memories?.length && <div>Fontes: {m.memories.map((path, n) => <span key={n}>{n > 0 ? ', ' : ''}{onOpenMemory ? <button className="msg__copy" onClick={() => onOpenMemory(path)}>{path}</button> : path}</span>)}</div>}
                    {!!m.saved?.length && <div>Arquivos alterados: {m.saved.join(', ')}</div>}
                  </div>
                ) : null}
                <div className="msg__meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {m.role === 'assistant' && m.content && !m.streaming && (
                    <button className="msg__copy" onClick={() => copyMsg(m.content)} title="Copiar" aria-label="Copiar mensagem">Copiar</button>
                  )}
                  {m.role === 'assistant' && m.content && !m.streaming && !m.error && !m.cancelled && (
                    <button className="msg__copy" onClick={() => { setFixing(i); setFixClaim(m.content); setFixText(''); setFixError('') }}>Corrigir um fato</button>
                  )}
                  {m.corrected && <span className="faint" style={{ fontSize: 12 }}>Fato corrigido.</span>}
                </div>
                {fixing === i && (
                  <form onSubmit={e => { e.preventDefault(); void correct(i) }} style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                    <p className="faint">Escolha o trecho do fato ativo que precisa mudar. Para encontrar o registro, consulte a fonte e cole o texto completo do fato original.</p>
                    <label className="field"><span>Fato original</span><textarea rows={3} value={fixClaim} onChange={e => setFixClaim(e.target.value)} /></label>
                    <label className="field"><span>Informação correta</span><textarea rows={2} value={fixText} onChange={e => setFixText(e.target.value)} /></label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn--sm" type="submit" disabled={busy || fixClaim.trim().length < 3 || fixText.trim().length < 3}>Salvar correção</button>
                      <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={() => { setFixing(null); setFixError('') }}>Cancelar</button>
                      {onOpenMemory && <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={() => onOpenMemory('long-term/facts.md')}>Consultar fonte</button>}
                    </div>
                  </form>
                )}
                {fixing === i && fixError && <div role="alert" style={{ marginTop: 8 }}>{fixError}</div>}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {pendingPrompt !== null && <div role="status" style={{ padding: '8px 20px' }}>
          <span>Você tem um rascunho. Deseja substituí-lo pela mensagem sugerida?</span>{' '}
          <button className="msg__copy" onClick={() => { setInput(pendingPrompt); setPendingPrompt(null); taRef.current?.focus() }}>Usar mensagem sugerida</button>{' '}
          <button className="msg__copy" onClick={() => setPendingPrompt(null)}>Manter rascunho</button>
        </div>}
        <div className="chat-input">
          <textarea
            ref={taRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            aria-label="Mensagem para o KeepMind"
            placeholder="Mensagem para o KeepMind… (Enter para enviar)"
            rows={1}
          />
          {busy && requestId.current && typeof window.sb.brainCancel === 'function' && <button className="btn" onClick={cancel} disabled={cancelling}>{cancelling ? 'Interrompendo…' : 'Interromper'}</button>}
          <button aria-label="Enviar mensagem" className="btn btn--primary" onClick={send} disabled={busy || !input.trim()} style={{ borderRadius: 999, padding: '0 18px', height: 42 }}>
            {busy ? '…' : <IconSend size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
