import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import NeuralField from './components/NeuralField'
import { BrainMark, IconDashboard, IconChat, IconPlug, IconSettings, IconClock, IconSparkle, IconSync, IconToday, IconSkill, IconShield, IconDoc, IconTasks, IconPlus, IconPeople } from './components/icons'
import Wizard from './components/Wizard'
import Chat from './components/Chat'
import Today from './components/Today'
import Projects from './components/Projects'
import Memory, { type MemoryRequest } from './components/Memory'
import Capture from './components/Capture'
import Dialog from './components/Dialog'
import Login from './components/Login'
import CorpBar from './components/CorpBar'
import CorpOnboarding from './components/CorpOnboarding'

const Dashboard = lazy(() => import('./components/Dashboard'))
const Connectors = lazy(() => import('./components/Connectors'))
const Automations = lazy(() => import('./components/Automations'))
const Settings = lazy(() => import('./components/Settings'))
const GraphView = lazy(() => import('./components/GraphView'))
const Activity = lazy(() => import('./components/Activity'))
const AnswerBenchmark = lazy(() => import('./components/AnswerBenchmark'))
const Skills = lazy(() => import('./components/Skills'))
const Security = lazy(() => import('./components/Security'))
const Relationships = lazy(() => import('./components/Relationships'))

type View = 'today' | 'chat' | 'projects' | 'relationships' | 'memory' | 'automations' | 'graph' | 'dashboard' | 'skills' | 'security' | 'activity' | 'connectors' | 'answer-benchmark' | 'settings'
interface Toast { id: number; msg: string; kind: 'info' | 'error' | 'success' }
interface Job { phase: 'start' | 'done' | 'error'; name: string; summary?: string }
type NavItem = { id: View; label: string; shortLabel?: string; description?: string; Icon: (p: { size?: number }) => JSX.Element }

const PRIMARY: NavItem[] = [
  { id: 'today', label: 'Hoje', Icon: IconToday },
  { id: 'chat', label: 'Conversar', Icon: IconChat },
  { id: 'projects', label: 'Projetos', Icon: IconTasks },
  { id: 'relationships', label: 'Relacionamentos', shortLabel: 'Relações', Icon: IconPeople },
  { id: 'memory', label: 'Memória', Icon: IconDoc }
]
const TOOLS: NavItem[] = [
  { id: 'automations', label: 'Rotinas', description: 'Configure as tarefas recorrentes dos seus agentes.', Icon: IconClock },
  { id: 'connectors', label: 'Integrações', description: 'Conecte aplicativos e agentes à sua memória.', Icon: IconPlug },
  { id: 'graph', label: 'Conexões da memória', description: 'Explore as relações entre suas fontes.', Icon: IconSparkle },
  { id: 'activity', label: 'Atividade', description: 'Consulte o histórico de operações.', Icon: IconSync },
  { id: 'skills', label: 'Habilidades', description: 'Revise e organize instruções para seus agentes.', Icon: IconSkill },
  { id: 'answer-benchmark', label: 'Qualidade das respostas', description: 'Execute avaliações e confira as evidências.', Icon: IconDashboard },
  { id: 'dashboard', label: 'Diagnóstico', description: 'Veja a saúde e os detalhes da memória.', Icon: IconDashboard },
  { id: 'security', label: 'Segurança', description: 'Gerencie acesso, espaços e proteção de dados.', Icon: IconShield },
  { id: 'settings', label: 'Configurações', description: 'Aparência, modelo, sincronização e conta.', Icon: IconSettings }
]
const ALL_VIEWS = [...PRIMARY, ...TOOLS]

export default function App() {
  const [config, setConfig] = useState<any>(null)
  const [authState, setAuthState] = useState<{ needsSetup: boolean; user: any } | null>(null)
  const [startupError, setStartupError] = useState(false)
  const [startupAttempt, setStartupAttempt] = useState(0)
  const [view, setView] = useState<View>('today')
  const [visited, setVisited] = useState<View[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activity, setActivity] = useState(0.35)
  const [job, setJob] = useState<Job | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [dialog, setDialog] = useState<'search' | 'capture' | 'tools' | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [memoryRequest, setMemoryRequest] = useState<MemoryRequest>()
  const [projectId, setProjectId] = useState<string>()
  const [projectRequest, setProjectRequest] = useState(0)
  const [contactId, setContactId] = useState<string>()
  const [contactRequest, setContactRequest] = useState(0)
  const [chatPrompt, setChatPrompt] = useState<{ id: number; text: string }>()
  const [space, setSpace] = useState('personal')
  const [vaultLocked, setVaultLocked] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const sessionKey = `${authState?.user?.id ?? 'local'}:${space}${vaultLocked ? ':locked' : ''}`
  const activeView = useRef(view)
  activeView.current = view
  const requestSequence = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const toast = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = ++requestSequence.current
    setToasts(t => [...t.slice(-3), { id, msg, kind }])
    timers.current.push(setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 8000))
  }, [])
  const pulse = useCallback(() => {
    setActivity(a => Math.min(a + 0.55, 1.8))
    timers.current.push(setTimeout(() => setActivity(a => Math.max(a - 0.25, 0.35)), 900))
  }, [])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const loadConfig = useCallback(async () => { setConfig(await window.sb.getConfig()) }, [])
  useEffect(() => {
    let disposed = false
    setStartupError(false)
    Promise.all([window.sb.getConfig(), window.sb.authState()]).then(([c, auth]) => {
      if (!disposed) { setConfig(c); setAuthState(auth) }
    }).catch(() => { if (!disposed) setStartupError(true) })
    return () => { disposed = true }
  }, [startupAttempt])

  const navigate = useCallback((next: View, detail?: { projectId?: string; contactId?: string; query?: string; path?: string }) => {
    const focusOrigin = document.activeElement
    setDialog(null)
    if (next === 'projects' && detail?.projectId) { setProjectId(detail.projectId); setProjectRequest(n => n + 1) }
    if (next === 'relationships' && detail?.contactId) { setContactId(detail.contactId); setContactRequest(n => n + 1) }
    if (next === 'chat' && detail?.query) setChatPrompt({ id: ++requestSequence.current, text: detail.query })
    if (next === 'memory' && detail) setMemoryRequest({ id: ++requestSequence.current, query: detail.query, path: detail.path })
    setView(next)
    if (['chat', 'projects', 'relationships', 'memory', 'answer-benchmark'].includes(next)) setVisited(v => v.includes(next) ? v : [...v, next])
    if (!(next === 'chat' && detail?.query)) timers.current.push(setTimeout(() => {
      const current = document.activeElement
      // Do not steal focus if the user has already moved to another control.
      if (current === focusOrigin || current === document.body || !focusOrigin?.isConnected) document.getElementById('app-content')?.focus()
    }, 0))
    if (activeView.current === 'settings' || activeView.current === 'security') void loadConfig().catch(() => toast('Não foi possível atualizar as configurações exibidas.', 'error'))
  }, [loadConfig, toast])
  useEffect(() => {
    let disposed = false
    const apply = (status: any) => {
      if (disposed) return
      if (typeof status?.space === 'string') setSpace(status.space)
      setVaultLocked(status?.unlocked === false && !(window as any).__KEEPMIND_DEMO__ && !(window as any).__KEEPMIND_CORP__)
    }
    const refresh = () => window.sb.memorySecurityStatus?.().then(apply).catch(() => {})
    const scopeChanged = (event: Event) => apply((event as CustomEvent).detail)
    void refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('keepmind:memory-scope-change', scopeChanged)
    return () => { disposed = true; window.removeEventListener('focus', refresh); window.removeEventListener('keepmind:memory-scope-change', scopeChanged) }
  }, [view, config])
  useEffect(() => {
    setVisited(v => v.filter(item => item === activeView.current))
    setChatPrompt(undefined); setMemoryRequest(undefined); setProjectId(undefined); setContactId(undefined)
  }, [sessionKey])
  useEffect(() => {
    const offJob = window.sb.onJob?.((event: Job) => {
      setJob(event); pulse()
      if (event.phase !== 'start') setDataVersion(v => v + 1)
      if (event.name === 'Conversa' && activeView.current === 'chat') return
      if (event.phase === 'done' && event.summary) toast(`${event.name}: ${event.summary}`, 'success')
      if (event.phase === 'error' && event.summary) toast(`${event.name}: ${event.summary}`, 'error')
    })
    const offAct = window.sb.onActivityPush?.(() => pulse())
    return () => { offJob?.(); offAct?.() }
  }, [pulse, toast])
  useEffect(() => {
    let disposed = false
    const refresh = () => window.sb.automationPending?.().then((p: any[]) => { if (!disposed) setPendingCount(p?.length ?? 0) }).catch(() => { if (!disposed) setPendingCount(null) })
    refresh()
    const timer = setInterval(refresh, 30000)
    return () => { disposed = true; clearInterval(timer) }
  }, [view, dataVersion])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!config?.onboardingDone || !authState?.user) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); if (!dialog || dialog === 'search') setDialog(d => d === 'search' ? null : 'search')
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault(); if (!dialog) setDialog('capture')
      }
    }
    window.addEventListener('keydown', onKey)
    const offCapture = window.sb.onCapture?.(() => { if (!dialog) setDialog('capture') })
    return () => { window.removeEventListener('keydown', onKey); offCapture?.() }
  }, [config?.onboardingDone, authState?.user, dialog])

  const ready = async (intent?: { view: 'chat' | 'graph' | 'memory' | 'settings'; query?: string; path?: string }) => {
    await loadConfig()
    if (intent) navigate(intent.view === 'graph' ? 'memory' : intent.view, { query: intent.query, path: intent.path })
  }
  if (startupError) return <div className="startup-state" role="alert"><BrainMark size={50} /><h1>Não foi possível abrir o KeepMind</h1><p className="dim">Sua configuração ou sessão não pôde ser carregada.</p><button className="btn btn--primary" onClick={() => setStartupAttempt(n => n + 1)}>Tentar novamente</button></div>
  if (!config || !authState) return <div className="startup-state" role="status"><BrainMark size={50} /><p>Abrindo o KeepMind…</p></div>
  if (!authState.user) return <Login needsSetup={authState.needsSetup} googleConfigured={!!(config?.auth?.googleClientId && config?.auth?.googleClientSecret)} onDone={async () => { setAuthState(await window.sb.authState()); await loadConfig() }} />
  if (!config.onboardingDone) return <><NeuralField activity={0.7} />{config.corp ? <CorpOnboarding org={config.corp.org} onDone={loadConfig} /> : <Wizard config={config} onDone={ready} onToast={toast} />}<ToastWrap toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} /></>

  const corp = config.corp as { org?: string; role?: string; adminUrl?: string | null } | undefined
  const primary = PRIMARY.filter(n => !(corp && n.id === 'projects'))
  const tools = TOOLS.filter(n => !(corp && ['connectors', 'automations'].includes(n.id)))
  const label = ALL_VIEWS.find(n => n.id === view)?.label ?? 'KeepMind'
  const primaryView = view === 'graph' ? 'memory' : view
  const jobLine = job?.phase === 'start' ? `${job.name} em andamento` : job?.phase === 'error' ? 'Uma operação precisa de atenção' : 'Pronto para continuar'
  const memoryProps = { refreshToken: dataVersion, onCapture: () => setDialog('capture'), onAsk: (text: string) => navigate('chat', { query: text }), onOpenGraph: () => navigate('graph'), onOpenSource: (path: string) => navigate('memory', { path }) }
  const navigateToday = (next: View, detail?: { projectId?: string; contactId?: string; query?: string; path?: string }) => navigate(next === 'graph' ? 'memory' : next, detail)

  return <div className="app">
    <div className="app-surface" id="app-surface">
      <a className="skip-link" href="#app-content">Ir para o conteúdo</a>
      {corp && <CorpBar org={corp.org ?? 'Organização'} role={corp.role ?? 'member'} adminUrl={corp.adminUrl} />}
      {view !== 'graph' && <NeuralField activity={activity} />}
      <aside className="sidebar">
        <button className="brand brand-button" onClick={() => navigate('today')} aria-label="KeepMind — início"><BrainMark size={34} /><span className="brand__text"><span className="brand__name">keep<em>mind</em></span><span className="brand__tag">Seu contexto, sempre com você</span></span></button>
        <button className="btn btn--primary sidebar-capture" onClick={() => setDialog('capture')} title="Capturar · Ctrl / ⌘ + Shift + M"><IconPlus size={18} /><span>Capturar</span></button>
        <nav className="nav" aria-label="Navegação principal"><div className="nav__group">{primary.map(n => <button key={n.id} className={`nav__item ${primaryView === n.id ? 'is-active' : ''}`} onClick={() => navigate(n.id)} aria-current={primaryView === n.id ? 'page' : undefined} aria-label={n.label} title={n.label}><span className="ico" aria-hidden="true"><n.Icon size={19} /></span><span className="nav__label">{n.label}</span>{n.id === 'automations' && pendingCount !== null && pendingCount > 0 && <span className="nav__badge">{pendingCount}</span>}</button>)}</div></nav>
        <div className="sidebar__foot"><button className={`nav__item${!PRIMARY.some(n => n.id === primaryView) ? ' is-active' : ''}`} onClick={() => setDialog('tools')} title="Ferramentas e configurações" aria-label="Ferramentas e configurações"><span className="ico" aria-hidden="true"><IconSettings size={19} /></span><span className="nav__label">Ferramentas</span></button><button className="status-pill" onClick={() => navigate('settings')} title={`Modelo configurado: ${config.ai?.provider ?? 'nenhum'}`}><span className="status-pill__text">Modelo · {config.ai?.provider ?? 'Configurar'}</span></button><div className="sidebar-status" title={jobLine}><span className={`status-dot${job?.phase === 'start' ? ' is-working' : job?.phase === 'error' ? ' has-error' : ''}`} /><span>{jobLine}</span></div></div>
      </aside>
      <div className="app-workspace"><header className="app-toolbar"><div className="app-breadcrumb"><span>KeepMind</span><span aria-hidden="true">/</span><strong>{label}</strong></div><div className="toolbar-actions"><button className="toolbar-search" onClick={() => setDialog('search')} aria-label="Buscar na memória e navegar"><span>Buscar</span><kbd>⌘ / Ctrl K</kbd></button><button className="btn btn--sm toolbar-capture" onClick={() => setDialog('capture')}><IconPlus size={16} /><span>Capturar</span></button><button className="icon-button toolbar-tools" onClick={() => setDialog('tools')} aria-label="Ferramentas e configurações"><IconSettings size={19} /></button></div></header>
        {vaultLocked && <div className="lock-status" role="status"><span>Desbloqueie sua memória para guardar e consultar informações.</span><button className="btn btn--sm" onClick={() => navigate('settings')}>Desbloquear</button></div>}
        {(window as any).__KEEPMIND_DEMO__ && <div className="demo-status">Prévia com dados fictícios. Use o aplicativo para guardar sua memória.</div>}
        <main className="main" id="app-content" tabIndex={-1} aria-label={label}>
          <Suspense fallback={<div className="view" role="status">Abrindo {label.toLowerCase()}…</div>}>
            {view === 'today' && <Today key={sessionKey} refreshToken={dataVersion} onToast={toast} onNavigate={navigateToday} onCapture={() => setDialog('capture')} />}
            {visited.includes('projects') && <div className="retained-view" hidden={view !== 'projects'} key={`projects:${sessionKey}`}><Projects unsupported={!!corp} initialProjectId={projectId} initialProjectRequest={projectRequest} onResume={text => navigate('chat', { query: text })} /></div>}
            {visited.includes('relationships') && <div className="retained-view" hidden={view !== 'relationships'} key={`relationships:${sessionKey}`}><Relationships active={view === 'relationships'} refreshToken={dataVersion} initialContactId={contactId} initialRequest={contactRequest} onAsk={text => navigate('chat', { query: text })} onOpenSource={path => navigate('memory', { path })} /></div>}
            {visited.includes('chat') && <div className="retained-view" hidden={view !== 'chat'} key={`chat:${sessionKey}`}><Chat onActivity={pulse} active={view === 'chat'} sessionKey={sessionKey} initialPrompt={chatPrompt} onOpenMemory={path => navigate('memory', { path })} /></div>}
            {visited.includes('answer-benchmark') && <div className="retained-view" hidden={view !== 'answer-benchmark'} key={`benchmark:${sessionKey}`}><AnswerBenchmark space={space} /></div>}
            {visited.includes('memory') && <div className="retained-view" hidden={view !== 'memory'} key={`memory:${sessionKey}`}><Memory initialRequest={memoryRequest} {...memoryProps} /></div>}
            {view === 'dashboard' && <Dashboard onActivity={pulse} onToast={toast} />}
            {view === 'security' && <Security onActivity={pulse} onToast={toast} />}
            {view === 'skills' && <Skills onActivity={pulse} onToast={toast} />}
            {view === 'graph' && <GraphView />}
            {view === 'activity' && <Activity />}
            {view === 'connectors' && <Connectors onActivity={pulse} onToast={toast} />}
            {view === 'automations' && <Automations onActivity={pulse} onToast={toast} />}
            {view === 'settings' && <Settings onToast={toast} onActivity={pulse} />}
          </Suspense>
        </main>
        <footer className="app-footer">KeepMind · <button className="app-footer__link" onClick={() => window.sb.openExternal('https://zeroagency.ai')}>Zero Agency</button></footer>
      </div>
      <nav className="mobile-nav" aria-label="Navegação compacta">{primary.map(n => <button key={n.id} className={`mobile-nav__item ${primaryView === n.id ? 'is-active' : ''}`} onClick={() => navigate(n.id)} aria-label={n.label} aria-current={primaryView === n.id ? 'page' : undefined}><n.Icon size={20} /><span className="mobile-nav__label">{n.shortLabel ?? n.label}</span></button>)}</nav>
    </div>
    {dialog === 'capture' && <Capture value={drafts[sessionKey] ?? ''} onChange={text => setDrafts(d => ({ ...d, [sessionKey]: text }))} onClose={() => setDialog(null)} onSaved={() => { toast('Guardado na memória.', 'success'); setDataVersion(v => v + 1) }} />}
    {dialog === 'search' && <Dialog title="Buscar e navegar" onClose={() => setDialog(null)} wide><div className="command-shortcuts" aria-label="Atalhos de navegação">{primary.map(n => <button className="btn btn--ghost btn--sm" key={n.id} onClick={() => navigate(n.id)}><n.Icon size={15} />{n.label}</button>)}<button className="btn btn--ghost btn--sm" onClick={() => setDialog('tools')}>Ferramentas</button></div><Memory compact {...memoryProps} /></Dialog>}
    {dialog === 'tools' && <Dialog title="Ferramentas e configurações" onClose={() => setDialog(null)} wide><p className="dim">Os recursos avançados continuam aqui, quando você precisar.</p><div className="tool-grid">{tools.map(n => <button className="tool-link" key={n.id} onClick={() => navigate(n.id)}><n.Icon size={22} /><span><strong>{n.label}</strong><small>{n.description}</small></span><span aria-hidden="true">→</span></button>)}</div></Dialog>}
    <ToastWrap toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
  </div>
}

function ToastWrap({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return <div className="toast-wrap">{toasts.map(t => <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`toast toast--${t.kind}`}><span>{t.msg}</span><button className="toast__x" aria-label="Fechar notificação" onClick={() => onDismiss(t.id)}>×</button></div>)}</div>
}
