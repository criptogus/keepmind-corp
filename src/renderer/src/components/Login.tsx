import { useState } from 'react'
import { BrainMark } from './icons'

interface Props {
  needsSetup: boolean
  googleConfigured: boolean
  onDone: () => void
}

export default function Login({ needsSetup, googleConfigured, onDone }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>(needsSetup ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [googleWaiting, setGoogleWaiting] = useState(false)

  const submit = async () => {
    setBusy(true); setError('')
    try {
      if (mode === 'register') await window.sb.authRegister(email, password, name)
      else await window.sb.authLogin(email, password)
      onDone()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally { setBusy(false) }
  }

  const google = async () => {
    setGoogleWaiting(true); setError('')
    try {
      await window.sb.authGoogleLogin()
      onDone()
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setGoogleWaiting(false)
    }
  }

  return (
    <div style={{
      height: '100%', display: 'grid', placeItems: 'center',
      background: 'radial-gradient(ellipse at 50% 40%, rgba(8,47,90,.4), var(--bg) 70%)',
      position: 'relative'
    }}>
      <div className="card card-pad" style={{ width: 400, maxWidth: '92vw' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <BrainMark size={52} />
          </div>
          <h1 style={{ fontSize: 18 }}>KeepMind SB</h1>
          <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            {needsSetup ? 'Create this computer\'s account to begin' : 'Sign in to see what the brain did'}
          </p>
        </div>

        {mode === 'register' && (
          <div className="field">
            <label>Your name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Alex" autoFocus />
          </div>
        )}
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com" autoFocus={mode === 'login'} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'at least 8 characters' : '••••••••'}
            onKeyDown={e => e.key === 'Enter' && submit()} />
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 12.5, marginBottom: 12 }}>{error}</p>}

        <button className="btn btn--primary" style={{ width: '100%', padding: '12px' }} onClick={submit} disabled={busy || !email || !password}>
          {busy ? 'WORKING…' : mode === 'register' ? 'CREATE ACCOUNT' : 'SIGN IN'}
        </button>

        {!needsSetup && (
          <button className="btn btn--ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
            {mode === 'login' ? 'No account? Create one' : 'Have an account? Sign in'}
          </button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          <span className="faint" style={{ fontSize: 10, letterSpacing: '.15em' }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        </div>

        <button
          className="btn"
          style={{ width: '100%', borderColor: 'rgba(250,250,250,.25)', color: '#fff' }}
          onClick={google}
          disabled={googleWaiting || !googleConfigured}
          title={googleConfigured ? '' : 'Configure Google OAuth in Settings → Account'}
        >
          {googleWaiting ? 'WAITING FOR GOOGLE…' : 'G SIGN-IN WITH GOOGLE'}
        </button>
        {!googleConfigured && (
          <p className="faint" style={{ fontSize: 10.5, marginTop: 8, textAlign: 'center' }}>
            Google sign-in needs an OAuth client — set it up in Settings → Account after signing in.
          </p>
        )}
      </div>
    </div>
  )
}
