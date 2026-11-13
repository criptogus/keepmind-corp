import { useRef, useState } from 'react'
import Dialog from './Dialog'

export default function Capture({ value, onChange, onClose, onSaved }: {
  value: string; onChange: (text: string) => void; onClose: () => void; onSaved: (text: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const save = async () => {
    const text = value.trim()
    if (saving.current || text.replace(/\s+/g, ' ').length < 3) return
    saving.current = true; setBusy(true); setError('')
    try {
      const result = await window.sb.brainCapture(text)
      if (result === false || (result && typeof result === 'object' && result.error)) throw new Error('Capture was not saved')
      // The legacy API returns a validation message rather than rejecting.
      if (typeof result === 'string' && result.startsWith('Escreva uma frase')) throw new Error(result)
      onChange(''); onSaved(text); onClose()
    } catch {
      setError('Não foi possível salvar. Seu rascunho continua aqui; tente novamente.')
    } finally { saving.current = false; setBusy(false) }
  }
  return <Dialog title="Capturar uma ideia" onClose={onClose} busy={busy}>
    <form onSubmit={e => { e.preventDefault(); void save() }}>
      <p className="dim">Guarde uma informação agora. Você pode encontrá-la, usá-la e corrigi-la depois.</p>
      <label className="field capture-field"><span>O que você quer lembrar?</span><textarea data-autofocus rows={6} value={value} disabled={busy} onChange={e => onChange(e.target.value)} placeholder="Uma ideia, um contexto ou um fato que vale guardar…" onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save() } }} /></label>
      {error && <p className="feedback feedback--error" role="alert">{error}</p>}
      <div className="dialog__actions"><span className="dim">{busy ? 'Salvando na memória…' : 'Ctrl / ⌘ + Enter para salvar'}</span><button className="btn btn--ghost" type="button" disabled={busy} onClick={onClose}>Continuar depois</button><button className="btn btn--primary" type="submit" disabled={busy || value.trim().length < 3}>{busy ? 'Salvando…' : error ? 'Tentar novamente' : 'Guardar na memória'}</button></div>
    </form>
  </Dialog>
}
