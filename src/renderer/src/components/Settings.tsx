import MemorySecurity from './MemorySecurity'
import CorpSyncCard from './CorpSyncCard'
import { useEffect, useState } from 'react'
import { IconSparkle } from './icons'
import { useAppearance } from '../lib/appearance'

interface Props {
  onToast: (m: string, k?: 'info' | 'error' | 'success') => void
  onActivity?: () => void
}

const PROVIDERS = [
  { id: 'local', mark: '⌂', accent: '#22d3ee', name: 'Local (built-in)', desc: 'Runs on your machine via llama.cpp. Private, offline.' },
  { id: 'codex', mark: '◎', accent: '#4ade80', name: 'Codex / ChatGPT', desc: 'Reuses your Codex CLI login. No key needed.' },
  { id: 'claude-oauth', mark: '✳', accent: '#c4b5fd', name: 'Claude (sign-in)', desc: 'Claude Pro/Max via `claude setup-token`.' },
  { id: 'anthropic', mark: 'A', accent: '#fbbf24', name: 'Claude API', desc: 'Anthropic API key. Pay-per-token.' },
  { id: 'openai', mark: 'O', accent: '#34d399', name: 'OpenAI', desc: 'OpenAI API key (GPT-4o, o-series).' },
  { id: 'grok', mark: 'X', accent: '#e5e7eb', name: 'Grok', desc: 'xAI API key from console.x.ai.' },
  { id: 'gemini', mark: 'G', accent: '#60a5fa', name: 'Gemini', desc: 'Free API key from Google AI Studio.' },
  { id: 'ollama', mark: 'L', accent: '#fb923c', name: 'Ollama', desc: 'Uses your existing Ollama install.' }
]

export default function Settings({ onToast, onActivity }: Props) {
  const { reducedMotion } = useAppearance()
  const [passphrase, setPassphrase] = useState('')
  const [config, setConfig] = useState<any>(null)
  const [providers, setProviders] = useState<any[]>([])
  const [local, setLocal] = useState<any>(null)
  const [provider, setProvider] = useState('local')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<any>(null)
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null)

  const refresh = async () => {
    const [c, p, l] = await Promise.all([
      window.sb.getConfig(), window.sb.aiProviders(), window.sb.localLlmStatus()
    ])
    setConfig(c); setProviders(p); setLocal(l)
    setProvider(c.ai?.provider ?? 'local')
    setApiKey(c.ai?.apiKey ?? '')
    const plist = (p as any[])?.find((x: any) => x.id === (c.ai?.provider ?? 'local'))?.models
    setModel(plist?.length ? (plist.includes(c.ai?.model) ? c.ai.model : plist[0]) : (c.ai?.model ?? ''))
  }

  useEffect(() => {
    refresh()
    const off = window.sb.onLocalLlmProgress(setProgress)
    return off
  }, [])

  const currentProvider = providers.find(p => p.id === provider)

  const save = async () => {
    setBusy(true); setTest(null)
    try {
      await window.sb.updateAi({ provider, apiKey: apiKey || undefined, model: model || undefined })
      onToast('Settings saved', 'success')
      await refresh()
    } catch (e: any) { onToast(String(e?.message ?? e), 'error') }
    finally { setBusy(false) }
  }

  const testConn = async () => {
    setBusy(true); setTest(null)
    try {
      const res = await window.sb.aiTest({ provider, apiKey: apiKey || undefined, model: model || undefined })
      setTest(res.ok ? { ok: true, msg: `Connected — reply: ${res.reply}` } : { ok: false, msg: res.error })
    } catch (e: any) { setTest({ ok: false, msg: String(e?.message ?? e) }) }
    finally { setBusy(false) }
  }

  const ensureLocal = async () => {
    setBusy(true); onActivity?.()
    try {
      const modelId = model || local?.config?.modelId || 'qwen2.5-3b'
      await window.sb.updateLocalLlm({ modelId })
      await window.sb.localLlmEnsure(modelId)
      await window.sb.updateAi({ provider: 'local', model: modelId })
      setTest({ ok: true, msg: 'Local model ready' })
      onToast('Local brain ready 🧠', 'success')
      await refresh()
    } catch (e: any) {
      setTest({ ok: false, msg: String(e?.message ?? e) })
    } finally { setBusy(false); setProgress(null) }
  }

  const pushMemory = async () => {
    setBusy(true)
    try {
      const r = await window.sb.ghPushMemory('sync: memory update')
      onToast(`Synced ${r.pushed} files → GitHub`, 'success')
    } catch (e: any) { onToast(String(e?.message ?? e), 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>Ajustes</div>
          <h1>Ajustes</h1>
        </div>
      </div>

      <nav className="settings-nav">
        {([['Geral', 'sec-general'], ['Aparência', 'sec-appearance'], ['Modelo', 'sec-ai'], ['Arquivos', 'sec-models'], ['Sincronização', 'sec-memory'], ['Conta', 'sec-account'],
           ['Busca', 'sec-rag'], ['Decisões', 'sec-laya'], ['Atualizações', 'sec-updates'], ['Sobre', 'sec-about']] as const)
          .map(([label, id]) => (
            <button key={id} className="chip" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })}>
              {label}
            </button>
          ))}
      </nav>

      <div className="grid" style={{ maxWidth: 860 }}>
        <GeneralCard onToast={onToast} />
        <AppearanceCard />
        {/* AI provider */}
        <div className="card card-pad" id="sec-ai">
          <h2 style={{ marginBottom: 14 }}>Provedor de IA</h2>
          <div className="provider-grid" style={{ marginBottom: 16 }}>
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                className={`provider-card ${provider === p.id ? 'is-selected' : ''}`}
                style={{ '--accent': p.accent } as any}
                onClick={() => {
                  setProvider(p.id); setTest(null)
                  const next = providers.find(x => x.id === p.id)
                  setModel(next?.models?.length ? next.models[0] : '')
                }}
              >
                <div className="p-mark" style={{ color: p.accent, borderColor: `${p.accent}55`, background: `${p.accent}14` }}>{p.mark}</div>
                <div className="p-name">{p.name}</div>
                <div className="p-desc">{p.desc}</div>
                {config?.ai?.provider === p.id && <span className="p-current">CURRENT</span>}
              </button>
            ))}
          </div>

          {provider === 'local' ? (
            <div>
              <div className="faint" style={{ fontSize: 12.5, marginBottom: 10 }}>
                Bundled llama.cpp server · {local?.running ? '● running' : '○ stopped'} · endpoint {local?.endpoint ?? '—'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {(local?.catalog ?? []).map((m: any) => (
                  <label key={m.id} style={{ display: 'flex', gap: 10, padding: '8px 10px', alignItems: 'flex-start', cursor: 'pointer', borderRadius: 8, border: '1px solid transparent' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--line)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}>
                    <input type="radio" name="set-llm-model" checked={model === m.id || (!model && m.id === 'qwen2.5-3b')}
                      onChange={() => setModel(m.id)} style={{ marginTop: 3 }} />
                    <span>
                      <strong style={{ fontSize: 13 }}>{m.label}</strong>
                      <span className="faint" style={{ fontSize: 11.5 }}> · ~{m.sizeGB} GB · {m.description}</span>
                      {local?.config?.modelId === m.id && <span style={{ color: 'var(--green)', fontSize: 11 }}> · active</span>}
                    </span>
                  </label>
                ))}
              </div>
              {progress && (
                <div className="progress-bar" style={{ marginBottom: 10 }}>
                  <div style={{ width: progress.kind === 'model' && progress.total
                    ? `${Math.min(100, ((progress.downloaded ?? 0) / progress.total) * 100)}%`
                    : progress.kind === 'server' ? `${Math.round((progress.pct ?? 0) * 100)}%` : '50%' }} />
                </div>
              )}
              <button className="btn btn--primary" onClick={ensureLocal} disabled={busy}>
                {busy ? 'WORKING…' : '⬇ DOWNLOAD & START LOCAL MODEL'}
              </button>
            </div>
          ) : provider === 'codex' ? (
            <div>
              <CodexStatus />
              {currentProvider?.models?.length > 0 && (
                <div className="field" style={{ marginTop: 14 }}>
                  <label>Model</label>
                  <select value={model} onChange={e => setModel(e.target.value)}>
                    <option value="">default</option>
                    {currentProvider.models.map((m: string) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="field">
                <label>{provider === 'claude-oauth' ? 'Claude token' : 'API key'}</label>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder={
                    provider === 'anthropic' ? 'sk-ant-…' :
                    provider === 'claude-oauth' ? 'sk-ant-oat01-… (from `claude setup-token`)' :
                    provider === 'openai' ? 'sk-…' :
                    provider === 'grok' ? 'xai-… (console.x.ai)' :
                    provider === 'gemini' ? 'AIza…' : 'http://localhost:11434'} />
                {provider === 'claude-oauth' && (
                  <span className="hint">Run <code>claude setup-token</code> — it prints a long-lived token for your Claude Pro/Max plan.</span>
                )}
                {provider === 'grok' && (
                  <span className="hint">Create a key at console.x.ai → API Keys.</span>
                )}
              </div>
              {currentProvider?.models?.length > 0 && provider !== 'ollama' && (
                <div className="field">
                  <label>Model</label>
                  <select value={model} onChange={e => setModel(e.target.value)}>
                    <option value="">default</option>
                    {currentProvider.models.map((m: string) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}
              {provider === 'ollama' && (
                <div className="field">
                  <label>Model / base URL</label>
                  <input value={model} onChange={e => setModel(e.target.value)} placeholder="llama3.1 or http://localhost:11434" />
                </div>
              )}
            </>
          )}

          {test && (
            <p style={{ fontSize: 12.5, color: test.ok ? 'var(--green)' : 'var(--red)', marginTop: 12 }}>
              {test.ok ? '✓ ' : '✗ '}{test.msg}
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn" onClick={testConn} disabled={busy}>TEST CONNECTION</button>
            <button className="btn btn--primary" onClick={save} disabled={busy}>
              {busy ? 'SAVING…' : 'SAVE'}
            </button>
          </div>
        </div>

        <MemorySecurity />
        {!config?.corp ? <CorpSyncCard onToast={onToast} /> : null}
        {/* Models & runtimes */}
        <ModelsCard onToast={onToast} />

        {/* Memory / GitHub */}
        <div className="card card-pad" id="sec-memory">
          <h2 style={{ marginBottom: 14 }}>Memória e sincronização</h2>
          <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
            Your KeepMind stores everything as Markdown in your private GitHub repo.
            Push now to back up the current memory state.
          </p>
          <div className="faint mono" style={{ fontSize: 11.5, marginBottom: 14, wordBreak: 'break-all' }}>
            {config?.github?.repoUrl ?? 'GitHub not connected — run the setup wizard again'}
          </div>
          <label><input type="checkbox" disabled={busy || !config} checked={!!config?.github?.encryptionEnabled} onChange={async e => {
            try { setConfig(await window.sb.updateGithub({ encryptionEnabled: e.target.checked })) }
            catch (err: any) { onToast(String(err?.message ?? err), 'error') }
          }} /> Encrypt GitHub memory (end-to-end)</label>
          <input type="password" aria-label="Sync passphrase" autoComplete="off" placeholder="Sync passphrase (session only)" value={passphrase} onChange={e => setPassphrase(e.target.value)} />
          <button className="btn" disabled={!passphrase} onClick={async () => {
            try { await window.sb.unlockSync(passphrase); setPassphrase(''); onToast('Sync unlocked for this session', 'success') }
            catch (err: any) { onToast(String(err?.message ?? err), 'error') }
          }}>Unlock encrypted sync</button>
          <button className="btn" onClick={pushMemory} disabled={busy || !config?.github?.repoUrl}>
            <IconSparkle size={12} /> SYNC MEMORY TO GITHUB
          </button>
        </div>

        {/* Account & Google sign-in */}
        <AccountCard onToast={onToast} />

        {/* Semantic memory (RAG) */}
        <RagCard onToast={onToast} onActivity={onActivity} />
        <LayaCard onToast={onToast} />

        {/* Auto-updates */}
        <UpdatesCard onToast={onToast} />

        {/* About */}
        <AboutCard />
      </div>
    </div>
  )
}

const AUTONOMY_MODES = [
  {
    id: 'supervised', label: 'SUPERVISED',
    desc: 'Crons set to "approval" queue for your OK. Health recommendations wait for you to apply them.'
  },
  {
    id: 'autopilot', label: 'AUTOPILOT',
    desc: 'Every cron runs on schedule — nothing waits for approval. You still review health suggestions manually.'
  },
  {
    id: 'autonomous', label: 'AUTONOMOUS',
    desc: 'Fully hands-off: crons run free AND the brain analyzes its own health daily, enabling crons and applying improvements by itself.'
  }
] as const

function GeneralCard({ onToast }: { onToast: Props['onToast'] }) {
  const [background, setBackground] = useState(true)
  const [login, setLogin] = useState(false)
  const [autonomy, setAutonomy] = useState<string>('supervised')

  useEffect(() => {
    window.sb.getConfig?.().then((c: any) => {
      setBackground(c?.background !== false)
      setAutonomy(c?.autonomy ?? 'supervised')
    }).catch(() => {})
    window.sb.appLaunchAtLogin?.().then((s: any) => setLogin(!!s?.enabled)).catch(() => {})
  }, [])

  const setMode = async (v: string) => {
    const prev = autonomy
    setAutonomy(v)
    try {
      await window.sb.setConfig({ autonomy: v })
      onToast?.(`Autonomy: ${AUTONOMY_MODES.find(m => m.id === v)?.label}`, 'success')
    } catch (e: any) { setAutonomy(prev); onToast?.(String(e?.message ?? e), 'error') }
  }

  const toggleBackground = async (v: boolean) => {
    setBackground(v)
    try {
      await window.sb.setConfig({ background: v })
      onToast(v ? 'Background mode on — brain keeps running when window closes' : 'Background mode off — closing window quits KeepMind', 'success')
    } catch (e: any) { setBackground(!v); onToast(String(e?.message ?? e), 'error') }
  }

  const toggleLogin = async (v: boolean) => {
    setLogin(v)
    try {
      await window.sb.appSetLaunchAtLogin(v)
      onToast(v ? 'KeepMind will open at login' : 'Removed from login items', 'success')
    } catch (e: any) { setLogin(!v); onToast(String(e?.message ?? e), 'error') }
  }

  return (
    <div className="card card-pad" id="sec-general">
      <h2 style={{ marginBottom: 14 }}>Geral</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={background} onChange={e => toggleBackground(e.target.checked)} />
          <span>
            <strong style={{ color: 'var(--text)' }}>Keep running in background</strong>
            <div className="faint" style={{ fontSize: 12 }}>Closing the window keeps GitHub sync, crons and MCP agents alive — find KeepMind in the menu bar.</div>
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={login} onChange={e => toggleLogin(e.target.checked)} />
          <span>
            <strong style={{ color: 'var(--text)' }}>Open at login</strong>
            <div className="faint" style={{ fontSize: 12 }}>Start KeepMind automatically when this computer boots.</div>
          </span>
        </label>
        <div>
          <strong style={{ color: 'var(--text)', fontSize: 13 }}>Autonomy mode</strong>
          <div className="faint" style={{ fontSize: 12, margin: '4px 0 10px' }}>How much the brain does without asking you first.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {AUTONOMY_MODES.map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                style={{
                  textAlign: 'left', cursor: 'pointer', padding: '10px 14px', borderRadius: 10,
                  border: `1px solid ${autonomy === m.id ? 'var(--cyan)' : 'var(--line)'}`,
                  background: autonomy === m.id ? 'rgba(103,232,249,.06)' : 'transparent',
                  display: 'flex', gap: 12, alignItems: 'flex-start'
                }}
              >
                <span style={{
                  width: 9, height: 9, borderRadius: '50%', marginTop: 4, flexShrink: 0,
                  background: autonomy === m.id ? 'var(--cyan)' : 'var(--line)',
                  boxShadow: autonomy === m.id ? '0 0 8px var(--cyan)' : 'none'
                }} />
                <span>
                  <strong className="mono" style={{ fontSize: 11, letterSpacing: '.08em', color: autonomy === m.id ? 'var(--cyan)' : 'var(--text)' }}>{m.label}</strong>
                  <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{m.desc}</div>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function AppearanceCard() {
  const { avatarEnabled, motionEnabled, backgroundEnabled, reducedMotion, updateAppearance } = useAppearance()
  return <div className="card card-pad" id="sec-appearance">
    <h2 style={{ marginBottom: 8 }}>Aparência</h2>
    <p className="faint" style={{ fontSize: 12.5, marginBottom: 14 }}>Estas preferências valem apenas neste dispositivo.</p>
    <div style={{ display: 'grid', gap: 12 }}>
      <label><input type="checkbox" checked={avatarEnabled} onChange={e => updateAppearance({ avatarEnabled: e.target.checked })} /> Mostrar avatar do KeepMind</label>
      <label><input type="checkbox" checked={motionEnabled} onChange={e => updateAppearance({ motionEnabled: e.target.checked })} /> Ativar animações</label>
      <label><input type="checkbox" checked={backgroundEnabled} onChange={e => updateAppearance({ backgroundEnabled: e.target.checked })} /> Mostrar fundo decorativo</label>
      {reducedMotion && <span className="faint" style={{ fontSize: 12 }}>O movimento está reduzido pela sua preferência ou configuração do sistema.</span>}
    </div>
  </div>
}

function AboutCard() {
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.sb.updaterStatus?.().then((s: any) => setVersion(s?.version ?? '')).catch(() => {})
  }, [])
  return (
    <div className="card card-pad" id="sec-about">
      <h2 style={{ marginBottom: 14 }}>Sobre</h2>
      <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
        <p><strong style={{ color: 'var(--text)' }}>KeepMind</strong>{version ? ` v${version}` : ''} — open source, MIT.</p>
        <p style={{ marginTop: 8 }}>
          Local-first AI memory. Your data lives in <em>your</em> GitHub repo.
          The LLM can run fully offline on your machine.
        </p>
        <p className="mono" style={{ marginTop: 8, fontSize: 11 }}>
          electron · react · typescript · llama.cpp · mcp
        </p>
      </div>
    </div>
  )
}

function AccountCard({ onToast }: { onToast: Props['onToast'] }) {
  const [auth, setAuth] = useState<any>(null)
  const [gId, setGId] = useState('')
  const [gSecret, setGSecret] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.sb.authState?.().then(setAuth).catch(() => {})
    window.sb.getConfig?.().then((c: any) => {
      setGId(c?.auth?.googleClientId ?? '')
    }).catch(() => {})
  }, [])

  const saveGoogle = async () => {
    setBusy(true)
    try {
      await window.sb.authSetGoogleCreds(gId, gSecret)
      onToast('Google sign-in configured ✓', 'success')
    } catch (e: any) { onToast(String(e?.message ?? e), 'error') }
    finally { setBusy(false) }
  }

  const logout = async () => {
    await window.sb.authLogout()
    location.reload()
  }

  return (
    <div className="card card-pad" id="sec-account">
      <h2 style={{ marginBottom: 14 }}>Conta e acesso Google</h2>
      {auth?.user ? (
        <p style={{ fontSize: 13, marginBottom: 12 }}>
          Signed in as <strong>{auth.user.name || auth.user.email}</strong>{' '}
          <span className="faint mono" style={{ fontSize: 11 }}>({auth.user.email})</span>
        </p>
      ) : (
        <p className="faint" style={{ fontSize: 12.5, marginBottom: 12 }}>Not signed in.</p>
      )}
      <div className="field">
        <label>Google OAuth client ID</label>
        <input value={gId} onChange={e => setGId(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
      </div>
      <div className="field">
        <label>Client secret</label>
        <input type="password" value={gSecret} onChange={e => setGSecret(e.target.value)} placeholder="GOCSPX-…" />
        <span className="hint">
          Google Cloud Console → APIs & Services → Credentials → OAuth client (type: <strong>Desktop app</strong>).
          Add <code>http://127.0.0.1</code> as authorized redirect origin is not needed — the app uses a loopback port.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn" onClick={saveGoogle} disabled={busy}>SAVE GOOGLE CREDS</button>
        {auth?.user && <button className="btn btn--ghost" onClick={logout}>SIGN OUT</button>}
      </div>
    </div>
  )
}

function RagCard({ onToast, onActivity }: { onToast: Props['onToast']; onActivity?: () => void }) {
  const [rag, setRag] = useState<any>(null)
  const [local, setLocal] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<any>(null)

  const refresh = async () => {
    const [r, l] = await Promise.all([window.sb.ragStatus?.() ?? null, window.sb.localLlmStatus()])
    setRag(r); setLocal(l)
  }
  useEffect(() => {
    refresh()
    const off = window.sb.onLocalLlmProgress?.(setProgress)
    return off
  }, [])

  const setup = async (modelId: string) => {
    setBusy(true); onActivity?.()
    try {
      const s = await window.sb.ragSetup(modelId)
      setRag(s)
      onToast('Semantic memory ready 🧠', 'success')
    } catch (e: any) { onToast(String(e?.message ?? e), 'error') }
    finally { setBusy(false); setProgress(null) }
  }

  const reindex = async () => {
    setBusy(true)
    try { await window.sb.ragReindex(); await refresh(); onToast('Memory re-indexed', 'success') }
    catch (e: any) { onToast(String(e?.message ?? e), 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="card card-pad" id="sec-rag">
      <h2 style={{ marginBottom: 6 }}>Semantic memory (local RAG)</h2>
      <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        Embeds your memory locally (llama.cpp) and injects the most relevant chunks into every chat —
        the brain recalls by <em>meaning</em>, not just recency. ~65–300MB one-time download, fully offline.
      </p>
      {rag?.available ? (
        <div>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            {rag.running
              ? <span style={{ color: 'var(--green)' }}>● embedding server running</span>
              : <span className="faint">○ embedding server stopped (starts on launch)</span>}
            <span className="faint mono" style={{ fontSize: 11, marginLeft: 10 }}>
              {rag.embedded}/{rag.chunks} chunks indexed
            </span>
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={reindex} disabled={busy}>RE-INDEX MEMORY</button>
          </div>
        </div>
      ) : (
        <div>
          {(local?.embedCatalog ?? EMBED_MODELS_FALLBACK).map((m: any) => (
            <label key={m.id} style={{ display: 'flex', gap: 10, padding: '8px 0', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="radio" name="embed-model" style={{ marginTop: 3 }} />
              <span>
                <strong style={{ fontSize: 13 }}>{m.label}</strong>
                <span className="faint" style={{ fontSize: 11.5 }}> · ~{m.sizeMB} MB</span>
              </span>
              <button
                className="btn btn--sm"
                style={{ marginLeft: 'auto' }}
                disabled={busy}
                onClick={() => setup(m.id)}
              >
                {busy && progress?.kind === 'embed' ? 'DOWNLOADING…' : 'ENABLE'}
              </button>
            </label>
          ))}
          {progress?.kind === 'embed' && progress.total > 0 && (
            <div className="progress-bar" style={{ marginTop: 8 }}>
              <div style={{ width: `${Math.min(100, ((progress.downloaded ?? 0) / progress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LayaCard({ onToast }: { onToast: Props['onToast'] }) {
  const [st, setSt] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<any>(null)
  const [test, setTest] = useState<any>(null)

  const refresh = async () => setSt(await window.sb.layaStatus?.() ?? null)
  useEffect(() => {
    refresh()
    const off = window.sb.onLayaProgress?.(setProgress)
    return off
  }, [])

  const download = async () => {
    setBusy(true)
    try {
      const s = await window.sb.layaDownload()
      setSt(s)
      onToast('Decision engine ready ⚡', 'success')
    } catch (e: any) { onToast(String(e?.message ?? e), 'error') }
    finally { setBusy(false); setProgress(null) }
  }

  const runTest = async () => {
    setBusy(true)
    try { setTest(await window.sb.layaTest()) }
    catch (e: any) { onToast(String(e?.message ?? e), 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="card card-pad" id="sec-laya">
      <h2 style={{ marginBottom: 6 }}>Decision engine (Laya)</h2>
      <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        Fast System-1 decisions in a single ONNX forward pass (~33ms): memory classification,
        dedup checks and RAG reranking — the brain's reflexes, fully local. ~520MB one-time download.
      </p>
      {st?.available ? (
        <div>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            <span style={{ color: 'var(--green)' }}>● installed</span>
            <span className="faint mono" style={{ fontSize: 11, marginLeft: 10 }}>
              {st.loaded ? 'model loaded' : 'loads on first decision'}
            </span>
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={runTest} disabled={busy}>TEST DECISION</button>
          </div>
          {test && (
            <p className="faint mono" style={{ fontSize: 11.5, marginTop: 8 }}>
              test → {JSON.stringify(test.choice ?? test)} {test.confidence != null ? `(conf ${test.confidence.toFixed(2)})` : ''}
            </p>
          )}
        </div>
      ) : (
        <div>
          <button className="btn btn--primary" onClick={download} disabled={busy}>
            {busy ? 'DOWNLOADING…' : 'DOWNLOAD DECISION MODEL (~520MB)'}
          </button>
          {progress?.total > 0 && (
            <div className="progress-bar" style={{ marginTop: 10 }}>
              <div style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }} />
            </div>
          )}
          {progress?.file && <p className="faint mono" style={{ fontSize: 10.5, marginTop: 6 }}>{progress.file}</p>}
          {st?.error && <p style={{ color: '#f87171', fontSize: 11.5, marginTop: 8 }}>{st.error}</p>}
        </div>
      )}
    </div>
  )
}

function UpdatesCard({ onToast }: { onToast: Props['onToast'] }) {
  const [status, setStatus] = useState<any>(null)
  const [state, setState] = useState<string>('idle')
  const [version, setVersion] = useState('')
  const [pct, setPct] = useState<number | null>(null)

  useEffect(() => {
    window.sb.updaterStatus?.().then(setStatus).catch(() => {})
    const off = window.sb.onUpdaterEvent?.((e: any) => {
      if (e.channel === 'checking') setState('checking')
      else if (e.channel === 'available') setState('downloading')
      else if (e.channel === 'up-to-date') { setState('up-to-date'); onToast('You are on the latest version', 'success') }
      else if (e.channel === 'progress') setPct(e.percent)
      else if (e.channel === 'downloaded') { setState('ready'); setVersion(e.version ?? '') }
      else if (e.channel === 'error') { setState('error'); onToast(`Update failed: ${e.message}`, 'error') }
    })
    return off
  }, [])

  const check = async () => {
    setState('checking'); setPct(null)
    try {
      const r: any = await window.sb.updaterCheck?.()
      if (r && r.packaged === false) setState('dev')
    } catch { setState('error') }
  }

  const install = async () => {
    await window.sb.updaterInstall?.()
  }

  const label: Record<string, string> = {
    idle: 'Auto-updates from GitHub Releases are enabled in packaged builds.',
    checking: 'Checking for updates…',
    downloading: 'Downloading update…',
    'up-to-date': 'You are on the latest version.',
    ready: `Version ${version} downloaded — restart to apply.`,
    error: 'Update check failed.',
    dev: 'Updates only run in the installed app, not in dev mode.'
  }

  return (
    <div className="card card-pad" id="sec-updates">
      <h2 style={{ marginBottom: 6 }}>Atualizações</h2>
      <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        {status?.packaged === false
          ? 'Running in development mode — auto-update is disabled.'
          : 'The app checks GitHub Releases on launch and every 6 hours.'}
        {status?.version && <span className="mono" style={{ fontSize: 11 }}> · v{status.version}</span>}
      </p>
      <p style={{ fontSize: 12.5, marginBottom: state === 'downloading' ? 8 : 12, color: state === 'ready' ? 'var(--lime)' : state === 'error' ? 'var(--red)' : 'var(--text)' }}>
        {label[state] ?? label.idle}
      </p>
      {state === 'downloading' && pct != null && (
        <div className="progress-bar" style={{ marginBottom: 12 }}>
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        {state !== 'ready' && (
          <button className="btn" onClick={check} disabled={state === 'checking' || state === 'downloading'}>
            {state === 'checking' ? 'CHECKING…' : 'CHECK FOR UPDATES'}
          </button>
        )}
        {state === 'ready' && (
          <button className="btn btn--primary" onClick={install}>RESTART & UPDATE</button>
        )}
        <button className="btn btn--ghost" onClick={() => window.sb.openExternal('https://github.com/criptogus/keepmind/releases')}>
          RELEASE NOTES ↗
        </button>
      </div>
    </div>
  )
}

const EMBED_MODELS_FALLBACK = [
  { id: 'bge-small', label: 'BGE Small EN v1.5', sizeMB: 64 },
  { id: 'nomic-embed', label: 'Nomic Embed Text v1.5', sizeMB: 85 }
]

const KIND_LABEL: Record<string, string> = {
  chat: 'CHAT', embed: 'EMBED', runtime: 'RUNTIME', decision: 'DECISION'
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`
  return `${b} B`
}

function ModelsCard({ onToast }: { onToast: Props['onToast'] }) {
  const [models, setModels] = useState<any[] | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const load = () => window.sb.modelsList?.().then(setModels).catch(() => setModels([]))
  useEffect(() => { load() }, [])

  const del = async (m: any) => {
    if (!window.confirm(`Delete ${m.label} (${fmtBytes(m.sizeBytes)})?${m.active ? '\n\nThis is the ACTIVE model — the brain will fall back to the default.' : ''}`)) return
    setBusyKey(m.key)
    try {
      const r: any = await window.sb.modelsDelete?.(m.key)
      onToast(`Freed ${fmtBytes(r?.freedBytes ?? 0)}${r?.warnings?.[0] ? ` — ${r.warnings[0]}` : ''}`, 'success')
      await load()
    } catch (e: any) {
      onToast(`Delete failed: ${e?.message ?? e}`, 'error')
    } finally { setBusyKey(null) }
  }

  const total = (models ?? []).reduce((n, m) => n + (m.downloaded ? m.sizeBytes : 0), 0)

  return (
    <div className="card card-pad" id="sec-models">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <h2>Modelos e ambientes de execução</h2>
        {models && <span className="faint" style={{ fontSize: 11.5 }}>{fmtBytes(total)} on disk</span>}
      </div>
      <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
        Local AI assets downloaded by KeepMind — chat models, embeddings, the llama.cpp engine and the Laya decision model.
        Deleting frees disk space; models re-download automatically if needed again.
      </p>
      {!models ? (
        <p className="faint" style={{ fontSize: 12.5 }}>Loading…</p>
      ) : models.length === 0 ? (
        <p className="faint" style={{ fontSize: 12.5 }}>No local models yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {models.map(m => (
            <div key={m.key} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
              borderRadius: 8, border: '1px solid var(--line)', background: 'rgba(3,7,18,.4)'
            }}>
              <span className="mono" style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '.06em', minWidth: 64,
                color: m.kind === 'decision' ? '#c4b5fd' : m.kind === 'runtime' ? '#fbbf24' : m.kind === 'embed' ? '#34d399' : '#22d3ee'
              }}>{KIND_LABEL[m.kind]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {m.label}
                  {m.active && <span style={{ color: 'var(--green)', fontSize: 11, marginLeft: 8 }}>● ACTIVE</span>}
                  {m.running && <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>· running</span>}
                </div>
                {m.detail && <div className="faint" style={{ fontSize: 11, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.detail}</div>}
              </div>
              <span className="mono faint" style={{ fontSize: 11.5, minWidth: 64, textAlign: 'right' }}>
                {m.downloaded ? fmtBytes(m.sizeBytes) : '—'}
              </span>
              {m.downloaded && (
                <button className="btn btn--ghost" style={{ fontSize: 11, padding: '4px 10px' }}
                  disabled={busyKey === m.key} onClick={() => del(m)}>
                  {busyKey === m.key ? '…' : 'DELETE'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CodexStatus() {
  const [s, setS] = useState<any>(null)
  useEffect(() => {
    window.sb.aiCodexStatus?.().then(setS).catch(() => {})
  }, [])
  if (!s) return <div className="faint" style={{ fontSize: 12.5 }}>Checking Codex CLI login…</div>
  if (!s.loggedIn) {
    return (
      <div>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          No Codex login found. Install the <strong>Codex CLI</strong> and run{' '}
          <code className="mono">codex login</code> — KeepMind reuses that session. No API key needed.
        </p>
        <button className="btn btn--ghost" style={{ marginTop: 10 }} onClick={() => window.sb.aiCodexStatus?.().then(setS)}>
          ↻ RE-CHECK
        </button>
      </div>
    )
  }
  return (
    <p style={{ fontSize: 13, color: 'var(--green)' }}>
      ✓ Codex CLI signed in{s.email ? ` as ${s.email}` : ''}
    </p>
  )
}
