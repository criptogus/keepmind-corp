import { useEffect, useRef, useState } from 'react'
import KeepMindAvatar from './KeepMindAvatar'
import MemorySecurity from './MemorySecurity'
import { BrainMark, IconChat, IconDoc, IconPlug, IconSettings, IconShield, IconSparkle } from './icons'

interface Props {
  config: any
  onDone: (intent?: { view: 'chat' | 'graph' | 'settings'; query?: string; path?: string }) => void | Promise<void>
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void
}
const providers = [
  { id: 'local', name: 'Local', detail: 'No seu computador', requirement: 'Download de modelo', Icon: IconShield },
  { id: 'codex', name: 'Codex / ChatGPT', detail: 'Use sua sessão Codex', requirement: 'Login no Codex', Icon: IconChat },
  { id: 'claude-oauth', name: 'Claude (login)', detail: 'Conecte sua conta Claude', requirement: 'Token de acesso', Icon: IconChat },
  { id: 'anthropic', name: 'Claude API', detail: 'Use a API da Anthropic', requirement: 'Chave de API', Icon: IconPlug },
  { id: 'openai', name: 'OpenAI', detail: 'Use os modelos da OpenAI', requirement: 'Chave de API', Icon: IconPlug },
  { id: 'grok', name: 'Grok', detail: 'Use os modelos da xAI', requirement: 'Chave de API', Icon: IconSparkle },
  { id: 'gemini', name: 'Gemini', detail: 'Use os modelos do Google', requirement: 'Chave de API', Icon: IconSparkle },
  { id: 'ollama', name: 'Ollama', detail: 'Conecte seu próprio servidor', requirement: 'Ollama em execução', Icon: IconSettings }
] as const
const steps = ['Boas-vindas', 'Sua IA', 'Primeira ideia', 'Tudo pronto']
const titles = ['Um lugar para lembrar e retomar', 'Escolha uma IA. Sua memória continua sua.', 'Guarde algo que importa para você', 'Sua memória já começou']


export default function Wizard({ config, onDone, onToast }: Props) {
  const [step, setStep] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const scrollArea = useRef<HTMLElement>(null)
  useEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
  }, [step])
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
  const selected = providers.find(item => item.id === provider) ?? providers[0]
  const SelectedIcon = selected.Icon
  return <div className="wizard-screen">
    <header className="wizard__header">
      <div className="wizard__brand"><span aria-hidden="true"><BrainMark size={36} /></span><div><strong>KeepMind SB</strong><span>Seu contexto, sempre com você</span></div></div>
      <div className="wizard__progress" role="progressbar" aria-label="Progresso da configuração" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step + 1} aria-valuetext={`Etapa ${step + 1} de 4: ${steps[step]}`}>
        {steps.map((label, i) => <div key={label} className={`wizard__step ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`}><span className="wizard__step-dot" /><span>{label}</span></div>)}
      </div>
    </header>
    <main className="wizard__scroll" ref={scrollArea} aria-labelledby="wizard-title">
      <div className="wizard" key={step}>
        <div className="wizard__intro"><span className="hud-tag">Etapa {step + 1} de 4 · {steps[step]}</span><h1 id="wizard-title" ref={heading} tabIndex={-1}>{titles[step]}</h1>
          {step === 1 && <p>Encontre uma decisão, retome um projeto ou faça perguntas sobre o que guardou. Escolha como quer conversar com sua memória.</p>}
        </div>
        {error && <div className="wizard__error" role="alert">{error}<span>{step === 1 ? 'Se preferir, configure depois e continue com sua primeira ideia.' : 'O conteúdo desta etapa foi mantido. Tente novamente.'}</span></div>}
        {step === 0 && <section className="card wizard__card wizard__welcome"><KeepMindAvatar size={64} state="idle" /><h2>Guarde uma ideia. Encontre-a quando precisar.</h2><p className="sub">Uma decisão de hoje pode ser o contexto que falta amanhã. Vamos guardar algo seu, conferir a fonte e deixar um próximo passo pronto.</p><div className="wizard__benefits"><span><IconDoc /> Guarde o que importa</span><span><IconChat /> Pergunte com contexto</span><span><IconShield /> Confira e corrija a fonte</span></div><p className="faint">GitHub, integrações e outras opções podem ser configurados depois.</p></section>}
        {step === 1 && <div className="wizard__ai-layout">
          <section aria-label="Opções de inteligência artificial"><div className="provider-grid">{providers.map(({id,name,detail,requirement,Icon}) => <button key={id} className={`provider-card ${provider === id ? 'is-selected' : ''}`} aria-label={name} aria-describedby={`provider-${id}-detail`} aria-pressed={provider === id} disabled={busy} onClick={() => selectProvider(id)}><span className="wizard__provider-icon" aria-hidden="true"><Icon size={22} /></span><span className="wizard__provider-copy"><span className="p-name">{name}</span><span className="p-desc" id={`provider-${id}-detail`}>{detail}</span><span className="wizard__requirement">{requirement}</span></span>{provider === id && <span className="wizard__selected" aria-hidden="true">Selecionada</span>}</button>)}</div></section>
          <section key={provider} className="card wizard__setup" aria-label={`Configurar ${selected.name}`}>
            <div className="wizard__setup-heading"><span aria-hidden="true"><SelectedIcon size={24} /></span><div><span className="hud-tag">Sua escolha</span><h2>{selected.name}</h2></div></div>
            {provider === 'local' ? <><p>Respostas no seu computador, sem enviar suas conversas a um provedor de IA. Primeiro, baixe um modelo; depois ele pode responder offline.</p><fieldset disabled={busy} className="wizard__models"><legend>Escolha um modelo</legend>{localStatus?.catalog?.map((m: any) => <label key={m.id}><input type="radio" name="model" checked={model === m.id || (!model && m.id === 'qwen2.5-3b')} onChange={() => setModel(m.id)} /><span>{m.label}<small>Download de aproximadamente {m.sizeGB} GB</small></span></label>)}{!localStatus?.catalog?.length && <p className="faint">O modelo padrão será preparado ao continuar. O download pode levar alguns minutos.</p>}</fieldset>{progress && <p role="status">Preparando modelo{progress.pct != null ? ` · ${Math.round(progress.pct * 100)}%` : '…'}</p>}</>
              : provider === 'codex' ? <><p>Aproveite a sessão do Codex neste computador. Sua memória fica no KeepMind; o contexto necessário para responder é enviado ao provedor.</p><div className="wizard__connection" role="status"><span aria-hidden="true"><IconShield /></span><span>{codexStatus?.loggedIn ? 'Sessão Codex encontrada. Vamos testar a conexão ao continuar.' : 'Não encontramos uma sessão Codex. Entre pelo Codex CLI com codex login e verifique novamente.'}</span></div><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { window.sb.aiCodexStatus().then(setCodexStatus).catch(e => setError(String(e))) }}>Verificar login</button></>
              : <><p>{provider === 'ollama' ? 'Use um modelo que já roda no Ollama. As perguntas serão enviadas ao endereço que você configurar abaixo.' : provider === 'claude-oauth' ? 'Conecte o Claude com seu token de acesso. O contexto necessário para responder será enviado à Anthropic.' : 'Conecte sua conta com uma chave de API. O contexto necessário para responder será enviado ao provedor; a cobrança segue sua conta.'}</p><label className="field"><span>{provider === 'claude-oauth' ? 'Token Claude' : provider === 'ollama' ? 'Chave (opcional)' : 'Chave de API'}</span><input type="password" autoComplete="off" disabled={busy} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={provider === config?.ai?.provider && config?.ai?.apiKey ? 'Chave atual preservada' : 'Cole sua chave'} /></label>{provider === 'ollama' && <><label className="field"><span>Modelo</span><input disabled={busy} value={model} onChange={e => setModel(e.target.value)} placeholder="Nome do modelo" /></label><label className="field"><span>Endereço do Ollama (opcional)</span><input disabled={busy} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" /></label></>}</>}
            <div className="wizard__reassurance"><span aria-hidden="true"><IconDoc /></span><p>Você pode trocar de IA depois, sem recomeçar sua memória.</p></div>
          </section>
        </div>}
        {step === 2 && <section className="card wizard__card"><h2>Guarde sua primeira ideia</h2><p className="sub">Pode ser uma decisão, preferência ou algo que você queira lembrar. Ela será salva como fato ativo — e você poderá corrigir depois.</p>{securityError && <div role="alert">{securityError} <button className="btn" onClick={() => void checkMemory()}>Tentar novamente</button></div>}{memoryReady === null && !securityError && <p role="status">Verificando a proteção da memória…</p>}{memoryReady === false && <MemorySecurity setupOnly onBlockingChange={setSecurityBlocked} onStatusChange={status => setMemoryReady(status.unlocked === true)} />}<label className="field"><span>O que você quer guardar?</span><textarea rows={4} disabled={busy} value={capture} onChange={e => setCapture(e.target.value)} placeholder="Ex.: Prefiro reuniões curtas pela manhã." /></label></section>}
        {step === 3 && <section className="card wizard__card wizard__success"><span aria-hidden="true"><IconShield size={36} /></span><h2>Sua ideia foi guardada</h2><blockquote>{saved}</blockquote><p className="sub">Agora ela pode ajudar você a retomar o contexto. Confira a fonte ou faça uma pergunta quando sua IA estiver pronta.</p></section>}
      </div>
    </main>
    <footer className="wizard__footer">
      <p>{step === 1 ? 'Sem pressa: você pode guardar ideias sem escolher uma IA agora.' : 'Uma memória sua, que continua com você.'}</p>
      <div className="wizard__actions">
        {step === 0 && <button className="btn btn--primary" onClick={() => setStep(1)}>Começar →</button>}
        {step === 1 && <><button className="btn btn--ghost" disabled={busy} onClick={() => setStep(0)}>Voltar</button><button className="btn btn--ghost" disabled={busy} onClick={() => setStep(2)}>Configurar depois</button><button className="btn btn--primary" disabled={busy} onClick={() => void configure()}>{busy ? 'Configurando…' : 'Configurar e continuar'}</button></>}
        {step === 2 && <><button className="btn btn--ghost" disabled={busy || securityBlocked} onClick={() => setStep(1)}>Voltar</button>{!capture.trim() && <button className="btn btn--ghost" disabled={busy || securityBlocked} onClick={() => void finish()}>Fazer isso depois</button>}<button className="btn btn--primary" disabled={busy || memoryReady !== true || capture.trim().length < 3} onClick={() => void save()}>{busy ? 'Salvando…' : 'Guardar ideia'}</button></>}
        {step === 3 && <><button className="btn btn--ghost" disabled={busy} onClick={() => void finish()}>Ir para Hoje</button><button className="btn btn--ghost" disabled={busy} onClick={() => void finish({ view: 'graph', path: 'long-term/facts.md' })}>Ver fonte ou corrigir</button><button className="btn btn--primary" disabled={busy} onClick={() => void finish({ view: 'chat', query: 'O que você sabe sobre o que acabei de guardar?' })}>Fazer uma pergunta</button></>}
      </div>
    </footer>
  </div>
}
