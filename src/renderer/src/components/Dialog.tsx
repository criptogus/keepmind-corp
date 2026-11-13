import { useEffect, useId, useRef, type ReactNode } from 'react'

/** One modal at a time. Restores focus and keeps keyboard focus in the dialog. */
export default function Dialog({ title, children, onClose, busy = false, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const surface = document.getElementById('app-surface')
    surface?.setAttribute('inert', '')
    const dialog = ref.current!
    const visible = (element: HTMLElement) => {
      for (let node: HTMLElement | null = element; node && node !== dialog; node = node.parentElement) {
        if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return false
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        if (node.tagName === 'DETAILS' && !node.hasAttribute('open') && !node.querySelector(':scope > summary')?.contains(element)) return false
      }
      return true
    }
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')].filter(visible)
    ;(dialog.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0] ?? dialog).focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (!busyRef.current) closeRef.current()
      }
      if (event.key === 'Tab') {
        const elements = focusable()
        const first = elements[0] ?? dialog
        const last = elements.at(-1) ?? dialog
        if (!elements.length || (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement)))) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
      }
    }
    dialog.addEventListener('keydown', key)
    return () => {
      dialog.removeEventListener('keydown', key)
      surface?.removeAttribute('inert')
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <div className={`dialog${wide ? ' dialog--wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="dialog__head"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" aria-label="Fechar janela" disabled={busy} onClick={onClose}>×</button></header>
      <div className="dialog__body">{children}</div>
    </div>
  </div>
}
