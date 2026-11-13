import { useEffect, useRef, useState } from 'react'
import KeepMindAvatar from './KeepMindAvatar'
import MemorySecurity from './MemorySecurity'

interface Props {
  config: any
  onDone: (intent?: { view: 'chat' | 'graph' | 'settings'; query?: string; path?: string }) => void | Promise<void>
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void
}
const providers = [
  ['local', 'Local'], ['codex', 'Codex / ChatGPT'], ['claude-oauth', 'Claude (login)'], ['anthropic', 'Claude API'],
  ['openai', 'OpenAI'], ['grok', 'Grok'], ['gemini', 'Gemini'], ['ollama', 'Ollama']
] as const

export default function Wizard({ config, onDone, onToast }: Props) {
  const [step, setStep] = useState(0)
  const [provider, setProvider] = useState(config?.ai?.provider ?? 'local')
  const [apiKey, setApiKey] = useState(config?.ai?.apiKey ?? '')
  const [model, setModel] = useState(config?.ai?.model ?? '')
  const [baseUrl, setBaseUrl] = useState(config?.ai?.baseUrl ?? '')
  const providerDrafts = useRef<Record<string, { apiKey: string; model: string; baseUrl: string }>>({})
  const [localStatus, setLocalStatus] = useState<any>(null)
  const [progress, setProgress] = useState<any>(null)
  const [codexStatus, setCodexStatus] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const [capture, setCapture] = useState('')
  const [saved, setSaved] = useState('')
  const [memoryReady, setMemoryReady] = useState<boolean | null>(null)
  const [securityError, setSecurityError] = useState('')
  const [securityBlocked, setSecurityBlocked] = useState(false)
  const checkMemory = async () => {
    if (typeof window.sb.memorySecurityStatus !== 'function' || typeof window.sb.securitySetup !== 'function' || typeof window.sb.securityUnlock !== 'function') { setMemoryReady(true); return }
    setSecurityError(''); setMemoryReady(null)
    try { const status = await window.sb.memorySecurityStatus(); setMemoryReady(status.unlocked === true) }
    catch { setSecurityError('Não foi possível verificar a proteção da memória.'); setMemoryReady(null) }
  }
  useEffect(() => {
    void checkMemory()
    window.sb.localLlmStatus().then(setLocalStatus).catch(() => {})
    window.sb.aiCodexStatus?.().then(setCodexStatus).catch(() => {})
    return window.sb.onLocalLlmProgress?.(setProgress)
  }, [])
  const selectProvider = (id: string) => {
    providerDrafts.current[provider] = { apiKey, model, baseUrl }
    const draft = providerDrafts.current[id] ?? { apiKey: id === config?.ai?.provider ? config?.ai?.apiKey ?? '' : '', model: id === config?.ai?.provider ? config?.ai?.model ?? '' : '', baseUrl: id === config?.ai?.provider ? config?.ai?.baseUrl ?? '' : '' }
    setProvider(id); setApiKey(draft.apiKey); setModel(draft.model); setBaseUrl(draft.baseUrl); setError('')
  }
  const configure = async () => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (provider === 'local') {
        const modelId = model || localStatus?.config?.modelId || 'qwen2.5-3b'
        await window.sb.updateLocalLlm({ modelId })
        await window.sb.localLlmEnsure(modelId)
        await window.sb.updateAi({ provider: 'local', model: modelId, apiKey: undefined, baseUrl: undefined })
      } else {
        const available: any = await window.sb.aiProviders()
        // Configuration patches merge in the store. Explicitly clear another
        // provider's credentials/endpoint rather than inheriting them silently.
        const patch = { provider, apiKey: apiKey || undefined, model: model || available.find((p: any) => p.id === provider)?.models?.[0], baseUrl: (provider === 'ollama' || provider === config?.ai?.provider) ? baseUrl || undefined : undefined }
        const result = await window.sb.aiTest(patch)
        if (!result.ok) throw new Error(result.error || 'Não foi possível conectar.')
        await window.sb.updateAi(patch)
      }
      onToast('Provedor configurado.', 'success'); setStep(2)
    } catch (e) { setError(String((e as Error)?.message ?? e)) }
    finally { inFlight.current = false; setBusy(false); setProgress(null) }
  }
  const save = async () => {
    const text = capture.trim()
    if (inFlight.current || text.length < 3 || memoryReady !== true) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const result = await window.sb.brainCapture(text)
      if (typeof result === 'string' && /escreva uma frase|could not|erro|error/i.test(result)) throw new Error(result)
      setSaved(text); setStep(3); onToast(typeof result === 'string' ? result : 'Captura salva.', 'success')
    } catch (e) { setError(String((e as Error)?.message ?? e)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const finish = async (intent?: { view: 'chat' | 'graph' | 'settings'; query?: string; path?: string }) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try { await window.sb.setConfig({ onboardingDone: true }); await onDone(intent) }
    catch (e) { setError(String((e as Error)?.message ?? e)); inFlight.current = false; setBusy(false) }
  }
  return <div className="view" style={{ display: 'flex', alignItems: 'center' }}><div className="wizard">
    <div className="hud-tag" style={{ marginBottom: 8 }}>KEEPMIND · COMEÇAR</div><h1>Um lugar para lembrar e retomar</h1>
    <div className="wizard__stepper" role="progressbar" aria-label="Progresso da configuração" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step + 1} aria-valuetext={`Etapa ${step + 1} de 4`}>{['Boas-vindas', 'IA', 'Captura', 'Próximo passo'].map((label, i) => <div key={label} title={label} className={`wizard__step-dot ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`} />)}</div>
    {error && <div className="card card-pad" role="alert" style={{ marginBottom: 12, color: 'var(--red)' }}>{error}</div>}
    {step === 0 && <div className="card wizard__card"><KeepMindAvatar size={54} state="idle" /><h2 style={{ marginTop: 16 }}>Guarde uma ideia. Encontre-a quando precisar.</h2><p className="sub">Vamos começar com uma captura sua. Depois você poderá fazer perguntas, conferir a fonte e corrigir o que estiver errado.</p><button className="btn btn--primary btn--lg" onClick={() => setStep(1)}>Começar →</button><p className="faint" style={{ marginTop: 12 }}>GitHub, conectores e outras opções podem ser configurados depois.</p></div>}
    {step === 1 && <div className="card wizard__card"><h2>Escolha uma IA, se quiser</h2><p className="sub">Uma IA permite fazer perguntas. Você pode guardar sua primeira ideia sem configurar uma agora.</p><div className="provider-grid">{providers.map(([id, name]) => <button key={id} className={`provider-card ${provider === id ? 'is-selected' : ''}`} aria-pressed={provider === id} disabled={busy} onClick={() => selectProvider(id)}><div className="p-name">{name}</div></button>)}</div>
      {provider === 'local' ? <div className="card card-pad" style={{ marginBottom: 16 }}><p className="dim">O modelo local exige download antes de responder perguntas.</p>{localStatus?.catalog?.map((m: any) => <label key={m.id} style={{ display: 'block', marginTop: 8 }}><input type="radio" name="model" checked={model === m.id || (!model && m.id === 'qwen2.5-3b')} onChange={() => setModel(m.id)} /> {m.label} · ~{m.sizeGB} GB</label>)}{progress && <p className="dim">Preparando modelo{progress.pct != null ? ` · ${Math.round(progress.pct * 100)}%` : '…'}</p>}</div> : provider === 'codex' ? <div className="card card-pad" style={{ marginBottom: 16 }}><p className="dim">{codexStatus?.loggedIn ? 'Sessão Codex encontrada.' : 'Entre no Codex CLI com `codex login` e confira novamente.'}</p><button className="btn btn--ghost btn--sm" onClick={() => { window.sb.aiCodexStatus().then(setCodexStatus).catch(e => setError(String(e))) }}>Verificar login</button></div> : <><label className="field"><span>{provider === 'claude-oauth' ? 'Token Claude' : provider === 'ollama' ? 'Chave (opcional)' : 'Chave de API'}</span><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={provider === config?.ai?.provider && config?.ai?.apiKey ? 'Chave atual preservada' : 'Cole sua chave'} /></label>{provider === 'ollama' && <><label className="field"><span>Modelo</span><input value={model} onChange={e => setModel(e.target.value)} placeholder="Nome do modelo" /></label><label className="field"><span>Endereço do Ollama (opcional)</span><input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" /></label></>}</>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn btn--ghost" disabled={busy} onClick={() => setStep(0)}>Voltar</button><button className="btn btn--primary" disabled={busy} onClick={() => void configure()}>{busy ? 'Configurando…' : 'Configurar e continuar'}</button><button className="btn btn--ghost" disabled={busy} onClick={() => setStep(2)}>Configurar depois</button></div></div>}
    {step === 2 && <div className="card wizard__card"><h2>Guarde sua primeira ideia</h2><p className="sub">Pode ser uma decisão, preferência ou algo que você queira lembrar. Ela será salva como fato ativo.</p>{securityError && <div role="alert">{securityError} <button className="btn" onClick={() => void checkMemory()}>Tentar novamente</button></div>}{memoryReady === null && !securityError && <p role="status">Verificando a proteção da memória…</p>}{memoryReady === false && <MemorySecurity setupOnly onBlockingChange={setSecurityBlocked} onStatusChange={status => setMemoryReady(status.unlocked === true)} />}<label className="field"><span>O que você quer guardar?</span><textarea rows={4} disabled={busy} value={capture} onChange={e => setCapture(e.target.value)} placeholder="Ex.: Prefiro reuniões curtas pela manhã." /></label><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn btn--ghost" disabled={busy || securityBlocked} onClick={() => setStep(1)}>Voltar</button><button className="btn btn--primary" disabled={busy || memoryReady !== true || capture.trim().length < 3} onClick={() => void save()}>{busy ? 'Salvando…' : 'Guardar ideia'}</button>{!capture.trim() && <button className="btn btn--ghost" disabled={busy || securityBlocked} onClick={() => void finish()}>Fazer isso depois</button>}</div></div>}
    {step === 3 && <div className="card wizard__card"><h2>Sua ideia foi guardada</h2><p className="sub">“{saved}”</p><p className="dim" style={{ marginBottom: 16 }}>Agora você pode fazer uma pergunta ou abrir a memória para conferir a fonte e corrigir o registro.</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn btn--primary" disabled={busy} onClick={() => void finish({ view: 'chat', query: 'O que você sabe sobre o que acabei de guardar?' })}>Fazer uma pergunta</button><button className="btn btn--ghost" disabled={busy} onClick={() => void finish({ view: 'graph', path: 'long-term/facts.md' })}>Ver fonte ou corrigir</button><button className="btn btn--ghost" disabled={busy} onClick={() => void finish()}>Ir para Hoje</button></div></div>}
  </div></div>
}
