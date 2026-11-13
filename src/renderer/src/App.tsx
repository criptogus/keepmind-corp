import { useCallback, useEffect, useState } from 'react'
import NeuralField from './components/NeuralField'
import { BrainMark, IconDashboard, IconChat, IconPlug, IconSettings, IconClock, IconSparkle, IconSync, IconToday, IconSkill, IconShield } from './components/icons'
import Wizard from './components/Wizard'
import Chat from './components/Chat'
import Dashboard from './components/Dashboard'
import Connectors from './components/Connectors'
import Automations from './components/Automations'
import Settings from './components/Settings'
import GraphView from './components/GraphView'
import Activity from './components/Activity'
import Today from './components/Today'
import Projects from './components/Projects'
import AnswerBenchmark from './components/AnswerBenchmark'
import Skills from './components/Skills'
import Security from './components/Security'
import Login from './components/Login'
import CorpBar from './components/CorpBar'
import CorpOnboarding from './components/CorpOnboarding'

type View = 'answer-benchmark' | 'projects' | 'today' | 'graph' | 'dashboard' | 'skills' | 'security' | 'chat' | 'activity' | 'connectors' | 'automations' | 'settings'

interface Toast { id: number; msg: string; kind: 'info' | 'error' | 'success' }
interface Job { phase: 'start' | 'done' | 'error'; name: string; summary?: string }
interface Hit { path: string; title: string; snippet: string }

type NavItem = { id: View; label: string; Icon: (p: { size?: number }) => JSX.Element }

const NAV: { section: string; items: NavItem[] }[] = [
  { section: 'Brain', items: [
    { id: 'today', label: 'Today', Icon: IconToday },
    { id: 'projects', label: 'Projetos', Icon: IconDashboard },
    { id: 'graph', label: 'Brain', Icon: IconSparkle },
    { id: 'activity', label: 'Activity', Icon: IconSync }
  ]},
  { section: 'Mind', items: [
    { id: 'dashboard', label: 'Health', Icon: IconDashboard },
    { id: 'skills', label: 'Skills', Icon: IconSkill },
    { id: 'answer-benchmark', label: 'Qualidade', Icon: IconDashboard },
    { id: 'security', label: 'Security', Icon: IconShield }
  ]},
  { section: 'Agents', items: [
    { id: 'chat', label: 'Chat', Icon: IconChat },
    { id: 'connectors', label: 'Connect', Icon: IconPlug },
    { id: 'automations', label: 'Crons', Icon: IconClock }
  ]},
  { section: 'System', items: [
    { id: 'settings', label: 'Settings', Icon: IconSettings }
  ]}
]
const CORP_HIDDEN: View[] = ['connectors', 'automations']

function navForConfig(config: { corp?: unknown } | null) {
  if (!config?.corp) return NAV
  return NAV.map(g => ({
    ...g,
    items: g.items.filter(item => !CORP_HIDDEN.includes(item.id))
  })).filter(g => g.items.length > 0)
}

export default function App() {
  const [config, setConfig] = useState<any>(null)
  const [view, setView] = useState<View>('today')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activity, setActivity] = useState(0.35)
  const [authState, setAuthState] = useState<{ needsSetup: boolean; user: any } | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [palette, setPalette] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searchNotice, setSearchNotice] = useState('')
  const [opened, setOpened] = useState<{ path: string; content: string } | null>(null)
  const [capture, setCapture] = useState(false)
  const [captureText, setCaptureText] = useState('')
  const [codexOk, setCodexOk] = useState<boolean | null>(null)

  const toast = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 8000)
  }, [])

  const pulse = useCallback(() => {
    setActivity(a => Math.min(a + 0.55, 1.8))
    setTimeout(() => setActivity(a => Math.max(a - 0.25, 0.35)), 900)
  }, [])

  const loadConfig = useCallback(async () => {
    const c = await window.sb.getConfig()
    setConfig(c)
  }, [])

  useEffect(() => {
    loadConfig()
    window.sb.authState?.().then(setAuthState).catch(() => setAuthState({ needsSetup: false, user: { id: 0, email: 'local', name: 'Local' } }))
  }, [loadConfig])

  // Codex auth lives in the CLI login, not config.apiKey — probe it so the
  // model pill can show a truthful green/red dot.
  useEffect(() => {
    if (config?.ai?.provider !== 'codex') { setCodexOk(null); return }
    window.sb.aiCodexStatus?.().then((s: any) => setCodexOk(!!s?.loggedIn)).catch(() => setCodexOk(false))
  }, [config?.ai?.provider])

  useEffect(() => {
    const offJob = window.sb.onJob?.((e: Job) => {
      setJob(e)
      pulse()
      if (e.phase === 'done' && e.summary) toast(`${e.name}: ${e.summary}`, 'success')
      if (e.phase === 'error' && e.summary) toast(`${e.name}: ${e.summary}`, 'error')
    })
    const offAct = window.sb.onActivityPush?.(() => pulse())
    return () => { offJob?.(); offAct?.() }
  }, [pulse, toast])

  useEffect(() => {
    const refreshPending = () => window.sb.automationPending?.().then((p: any[]) => setPendingCount(p?.length ?? 0)).catch(() => {})
    refreshPending()
    const t = setInterval(refreshPending, 15000)
    return () => clearInterval(t)
  }, [view])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(v => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        setCapture(true)
      }
      if (e.key === 'Escape') { setPalette(false); setCapture(false) }
    }
    window.addEventListener('keydown', onKey)
    const offCapture = window.sb.onCapture?.(() => setCapture(true))
    return () => { window.removeEventListener('keydown', onKey); offCapture?.() }
  }, [])

  useEffect(() => {
    if (!palette) return
    const handle = setTimeout(async () => {
      if (query.trim().length < 2) { setHits([]); setSearchNotice(''); return }
      const found = await window.sb.brainSearch(query).catch(() => ({ hits: [], notice: '', semantic: false, asOf: null }))
      const pack = Array.isArray(found) ? { hits: found, notice: '' } : (found ?? { hits: [], notice: '' })
      setHits(pack.hits ?? [])
      setSearchNotice(pack.notice ?? '')
    }, 180)
    return () => clearTimeout(handle)
  }, [query, palette])

  const openHit = async (hit: Hit) => {
    const content = await window.sb.brainMemoryFile(hit.path).catch(() => '')
    setOpened({ path: hit.path, content: content ?? '' })
  }

  if (authState && !authState.user) {
    return (
      <Login
        needsSetup={authState.needsSetup}
        googleConfigured={!!(config?.auth?.googleClientId && config?.auth?.googleClientSecret)}
        onDone={async () => {
          const s = await window.sb.authState()
          setAuthState(s)
          await loadConfig()
        }}
      />
    )
  }

  if (!config) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <BrainMark size={64} />
          <p className="dim" style={{ marginTop: 18, fontFamily: 'var(--mono)', letterSpacing: '.12em', fontSize: 12 }}>
            Abrindo o KeepMind…
          </p>
        </div>
      </div>
    )
  }

  if (!config.onboardingDone) {
    const corpEdition = Boolean((config as { corp?: unknown }).corp)
    return (
      <>
        <NeuralField activity={0.7} />
        {corpEdition ? (
          <CorpOnboarding
            org={(config as { corp?: { org?: string } }).corp?.org}
            onDone={loadConfig}
          />
        ) : (
          <Wizard config={config} onDone={loadConfig} onToast={toast} />
        )}
        <ToastWrap toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
      </>
    )
  }

  const jobLine = job?.phase === 'start'
    ? `Now: ${job.name}`
    : job?.summary
      ? `${job.name}: ${job.summary}`
      : 'Brain awake · idle'

  const corp = config?.corp as { org?: string; role?: string; adminUrl?: string | null } | undefined
  const nav = navForConfig(config)
  const navFlat = nav.flatMap(g => g.items)

  return (
    <div className="app">
      {corp ? <CorpBar org={corp.org ?? 'Organization'} role={corp.role ?? 'member'} adminUrl={corp.adminUrl} /> : null}
      {/* The neural starfield stays out of the Brain view — two animated
          networks fighting for attention reads as visual noise. */}
      {view !== 'graph' && <NeuralField activity={activity} />}

      <aside className="sidebar">
        <div className="brand">
          <BrainMark size={36} />
          <div className="brand__text">
            <div className="brand__name">keep<em>mind</em></div>
            <div className="brand__tag">Your AI Second Brain</div>
          </div>
        </div>
        <nav className="nav">
          {nav.map(g => (
            <div key={g.section} className="nav__group">
              <div className="nav__section">{g.section}</div>
              {g.items.map(n => (
                <button
                  key={n.id}
                  className={`nav__item ${view === n.id ? 'is-active' : ''}`}
                  onClick={() => setView(n.id)}
                >
                  <span className="ico"><n.Icon size={17} /></span>
                  <span className="nav__label">{n.label}</span>
                  {n.id === 'automations' && pendingCount > 0 && <span className="nav__badge">{pendingCount}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="status-pill" onClick={() => setPalette(true)} style={{ width: '100%', cursor: 'pointer' }}>
          <span>Search memory</span>
          <span className="mono" style={{ marginLeft: 'auto' }}>Ctrl K</span>
        </button>
        <div className="sidebar__foot">
          <div className="status-pill" title={jobLine}>
            <span className={`dot ${job?.phase === 'error' ? 'off' : ''}`} />
            <span className="status-pill__text">{jobLine}</span>
          </div>
          <div className="status-pill">
            <span className={`dot ${config?.github?.repoUrl ? '' : 'off'}`} />
            <span className="status-pill__text">{config?.github?.repoUrl ? 'Repo connected' : 'Repo disconnected'}</span>
          </div>
          <button
            className="status-pill"
            onClick={() => { setView('settings'); setTimeout(() => document.getElementById('sec-ai')?.scrollIntoView({ behavior: 'smooth' }), 120) }}
            style={{ cursor: 'pointer' }}
            title="Active AI model — click to change"
          >
            {(() => {
              const p = config?.ai?.provider
              const active = p === 'local' || p === 'ollama' ? true
                : p === 'codex' ? codexOk === true
                : !!config?.ai?.apiKey
              return <span className={`dot ${active ? '' : 'off'}`} />
            })()}
            <span className="status-pill__text">Model · {config?.ai?.provider ?? '—'}</span>
          </button>
        </div>
      </aside>

      <nav className="mobile-nav">
        {navFlat.map(n => (
          <button
            key={n.id}
            className={`mobile-nav__item ${view === n.id ? 'is-active' : ''}`}
            onClick={() => setView(n.id)}
            aria-label={n.label}
            title={n.label}
          >
            <n.Icon size={18} />
            <span className="mobile-nav__label">{n.label}</span>
          </button>
        ))}
      </nav>

      <main className="main" style={{ zIndex: 1 }}>
        {view === 'today' && <Today onToast={toast} />}
        {view === 'projects' && <Projects unsupported={!!corp} />}
        {view === 'dashboard' && <Dashboard onActivity={pulse} onToast={toast} />}
        {view === 'security' && <Security onActivity={pulse} onToast={toast} />}
        {view === 'chat' && <Chat onActivity={pulse} />}
        {view === 'skills' && <Skills onActivity={pulse} onToast={toast} />}
        {view === 'answer-benchmark' && <AnswerBenchmark />}
        {view === 'graph' && <GraphView />}
        {view === 'activity' && <Activity />}
        {view === 'connectors' && <Connectors onActivity={pulse} onToast={toast} />}
        {view === 'automations' && <Automations onActivity={pulse} onToast={toast} />}
        {view === 'settings' && <Settings onToast={toast} onActivity={pulse} />}
      </main>

      {palette && (
        <div className="palette-back" onClick={() => setPalette(false)}>
          <div className="palette" onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              value={query}
              onChange={e => { setQuery(e.target.value); setOpened(null) }}
              placeholder="Search note, fact, task, report… or what was true in March"
            />
            {searchNotice && <p className="dim" style={{ padding: '8px 12px 0', fontSize: 13 }}>{searchNotice}</p>}
            <div className="palette__list">
              {hits.map((h, i) => (
                <button key={`${h.path}-${i}`} className="palette__hit" onClick={() => openHit(h)}>
                  <strong>{h.title}</strong>
                  {h.snippet && <span className="dim" style={{ display: 'block', fontSize: 12 }}>{h.snippet}</span>}
                  <span className="mono faint">{h.path}</span>
                </button>
              ))}
              {query.trim().length >= 2 && hits.length === 0 && <p className="dim" style={{ padding: 12 }}>Nothing matches that text.</p>}
            </div>
            {opened && (
              <div className="palette__file">
                <div className="mono faint">{opened.path}</div>
                <pre>{opened.content.slice(0, 4000)}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {capture && (
        <div className="palette-back" onClick={() => setCapture(false)}>
          <form
            className="palette"
            onClick={e => e.stopPropagation()}
            onSubmit={async e => {
              e.preventDefault()
              const text = captureText.trim()
              if (!text) return
              const msg = await window.sb.brainCapture(text).catch(() => 'Could not save that.')
              toast(String(msg), 'success')
              setCaptureText('')
              setCapture(false)
            }}
          >
            <p className="dim" style={{ margin: '0 0 8px', fontSize: 13 }}>Save a fact. It counts immediately.</p>
            <input autoFocus value={captureText} onChange={e => setCaptureText(e.target.value)} placeholder="A sentence worth remembering" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 12 }}>
              <button className="btn btn--primary btn--sm" type="submit">Save</button>
            </div>
          </form>
        </div>
      )}

      <footer className="app-footer">
        powered by{' '}
        <button
          className="app-footer__link"
          onClick={() => window.sb.openExternal('https://zeroagency.ai')}
        >
          Zero Agency
        </button>
      </footer>

      <ToastWrap toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
    </div>
  )
}

function ToastWrap({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.kind === 'error' ? 'error' : t.kind === 'success' ? 'success' : ''}`}>
          <span style={{ flex: 1 }}>{t.msg}</span>
          <button className="toast__x" aria-label="Fechar" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
