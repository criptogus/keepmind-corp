import { useEffect, useState, type ReactNode } from 'react'

// Preserve native tools; shared views are enabled only by an existing vault choice.
export default function SharedBrain({ screen, children, enabled = true }: { screen: string; children: ReactNode; enabled?: boolean }) {
  const [shared, setShared] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    window.sb.sharedBrainConfigured?.().then((value: boolean) => { if (active) setShared(value) }).catch(() => {})
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!shared) return
    let active = true
    const check = () => fetch('http://127.0.0.1:4175/ui/', { signal: AbortSignal.timeout(4000) })
      .then(r => { if (active) { if (r.ok) setReady(true); setError(!r.ok) } })
      .catch(() => { if (active) setError(true) })
    void check()
    const timer = setInterval(check, 10000)
    return () => { active = false; clearInterval(timer) }
  }, [shared])
  if (!enabled || !shared) return <>{children}</>
  const url = screen === 'Hoje' ? '/ui/?embed=1#hoje' : '/ui/?embed=1&surface=1&tab=' + encodeURIComponent(screen) + '#configuracoes'
  return <section className="shared-brain">
    <div className="shared-brain__tools"><small>{advanced ? 'Ferramentas do cofre nativo' : 'Memória compartilhada'}</small><button className="btn btn--sm" onClick={() => setAdvanced(v => !v)}>{advanced ? 'Voltar à memória real' : 'Ferramentas avançadas'}</button></div>
    <div className="shared-brain__content">{advanced ? children : ready ? <iframe title={screen + ' — memória real'} src={'http://127.0.0.1:4175' + url} sandbox="allow-scripts allow-same-origin allow-downloads" /> : <div className="view" role={error ? 'alert' : 'status'}>{error ? 'Serviço de memória indisponível. Reconectando…' : 'Conectando à memória…'}</div>}</div>
  </section>
}
