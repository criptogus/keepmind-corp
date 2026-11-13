import { useEffect, useRef, useState } from 'react'

interface Props {
  onStatusChange?: (status: any) => void
  setupOnly?: boolean
  onBlockingChange?: (blocked: boolean) => void
}

export default function MemorySecurity({ onStatusChange, setupOnly = false, onBlockingChange }: Props) {
  const [status, setStatus] = useState<any>(null)
  const [passphrase, setPassphrase] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [recovery, setRecovery] = useState('')
  const [space, setSpace] = useState('personal')
  const [grants, setGrants] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const recoveryRef = useRef('')
  const blockingRef = useRef(onBlockingChange)
  blockingRef.current = onBlockingChange
  const callbackRef = useRef(onStatusChange)
  callbackRef.current = onStatusChange

  const refresh = async (notify = true, publish = false) => {
    const next = await window.sb.memorySecurityStatus()
    setStatus(next); setSpace(next.space)
    if (publish) window.dispatchEvent(new CustomEvent('keepmind:memory-scope-change', { detail: next }))
    if (notify && !recoveryRef.current) callbackRef.current?.(next)
    return next
  }
  useEffect(() => { void refresh().catch(() => setError('Não foi possível verificar a proteção da memória. Tente novamente.')) }, [])

  const run = async (operation: () => Promise<void>, setup = false, publish = true) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); blockingRef.current?.(true)
    try {
      await operation()
      setPassphrase(''); setRecoveryInput('')
      await refresh(!setup, publish)
    } catch (e: any) {
      setError(`Não foi possível concluir a operação. ${e?.message || 'Confira os dados e tente novamente.'}`)
    } finally { inFlight.current = false; setBusy(false); blockingRef.current?.(!!recoveryRef.current) }
  }
  const acknowledge = async () => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); blockingRef.current?.(true)
    try {
      const next = await refresh(false)
      recoveryRef.current = ''; setRecovery('')
      callbackRef.current?.(next)
    } catch { setError('Não foi possível verificar a memória. Sua chave permanece visível; tente novamente.') }
    finally { inFlight.current = false; setBusy(false); blockingRef.current?.(!!recoveryRef.current) }
  }
  const retryStatus = async () => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try { await refresh() } catch { setError('Não foi possível verificar a proteção da memória. Tente novamente.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <div className="card card-pad">
    <h2>{setupOnly ? 'Proteja sua memória antes de guardar' : 'Proteção da memória'}</h2>
    <p>{status ? status.unlocked ? 'Memória desbloqueada.' : 'Memória bloqueada.' : 'Verificando a proteção da memória…'}</p>
    {recovery ? <div role="region" aria-label="Chave de recuperação">
      <p>Guarde esta chave de recuperação em um local seguro, fora do aplicativo. Ela é exibida apenas agora. Sem a senha e a chave, você poderá perder o acesso aos dados.</p>
      <code style={{ display: 'block', overflowWrap: 'anywhere', margin: '12px 0', userSelect: 'all' }}>{recovery}</code>
      <button className="btn btn--primary" disabled={busy} onClick={() => void acknowledge()}>{busy ? 'Verificando…' : 'Guardei minha chave de recuperação'}</button>
    </div> : status && <>
      {!status.unlocked && <>
        <label className="field"><span>Senha da memória</span><input type="password" autoComplete="off" value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="Senha da memória" /></label>
        {!status.configured ? <button className="btn btn--primary" disabled={busy || !passphrase} onClick={() => void run(async () => {
          const result = await window.sb.securitySetup(passphrase)
          if (!result?.recoveryKey) throw new Error('A chave de recuperação não foi retornada.')
          recoveryRef.current = result.recoveryKey; setRecovery(result.recoveryKey)
        }, true)}>{busy ? 'Configurando…' : 'Criar proteção'}</button> : <>
          <button className="btn btn--primary" disabled={busy || !passphrase} onClick={() => void run(async () => { await window.sb.securityUnlock({ passphrase }) })}>{busy ? 'Desbloqueando…' : 'Desbloquear com senha'}</button>
          <label className="field" style={{ marginTop: 12 }}><span>Chave de recuperação</span><input type="password" autoComplete="off" value={recoveryInput} onChange={e => setRecoveryInput(e.target.value)} placeholder="Chave de recuperação" /></label>
          <button className="btn" disabled={busy || !recoveryInput} onClick={() => void run(async () => { await window.sb.securityUnlock({ recoveryKey: recoveryInput }) })}>Recuperar acesso</button>
        </>}
      </>}
      {!setupOnly && status.unlocked && <>
        <button className="btn" disabled={busy} onClick={() => void run(async () => { await window.sb.securityLock() })}>Bloquear memória</button>
        <label className="field"><span>Espaço ativo</span><input value={space} onChange={e => setSpace(e.target.value)} /></label>
        <label className="field"><span>Permissões entre espaços</span><input value={grants} onChange={e => setGrants(e.target.value)} placeholder="Espaços permitidos, separados por vírgulas" /></label>
        <button className="btn" disabled={busy} onClick={() => void run(async () => { await window.sb.memorySecurityConfigure(space, grants.split(',').map(s => s.trim()).filter(Boolean), status.encryptAll) })}>Aplicar espaços</button>
        <button className="btn" disabled={busy} onClick={() => void run(async () => { const config = await window.sb.getConfig(); await window.sb.securityConsent(config.ai.provider) }, false, false)}>Permitir modelo de nuvem configurado neste espaço por 15 minutos</button>
        <label style={{ display: 'block', marginTop: 12 }}><input type="checkbox" disabled={busy} checked={status.encryptAll} onChange={e => void run(async () => { await window.sb.memorySecurityConfigure(space, grants.split(',').map(s => s.trim()).filter(Boolean), e.target.checked) })} /> Criptografar todas as notas. Desativar permite notas públicas ou internas em texto simples; anexos continuam criptografados.</label>
      </>}
    </>}
    {error && <div role="alert" style={{ marginTop: 12 }}><p>{error}</p>{!status && <button className="btn" disabled={busy} onClick={() => void retryStatus()}>Tentar novamente</button>}</div>}
  </div>
}
