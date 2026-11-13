// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Capture from '../src/renderer/src/components/Capture'
import Memory from '../src/renderer/src/components/Memory'
import Dialog from '../src/renderer/src/components/Dialog'
import { mdToHtml } from '../src/renderer/src/lib/markdown'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
const flush = async (ms = 0) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
async function mount(element: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(element)); await flush()
}
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)! }
async function click(target: HTMLElement) { expect(target).toBeTruthy(); await act(async () => target.click()); await flush() }
async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('capture and memory recovery', () => {
  it('preserves a failed capture, permits retry, and clears only on success', async () => {
    const saved = vi.fn(); const closed = vi.fn()
    const capture = vi.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue('Frase guardada. Ela já vale.')
    ;(window as any).sb = { brainCapture: capture }
    function Draft() { const [value, setValue] = useState('Uma ideia que merece continuar aqui.'); return <Capture value={value} onChange={setValue} onSaved={saved} onClose={closed} /> }
    await mount(<Draft />)
    await click(button('Guardar na memória'))
    expect(document.querySelector('textarea')!.value).toBe('Uma ideia que merece continuar aqui.')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('rascunho continua aqui')
    expect(saved).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled()
    await click(button('Tentar novamente'))
    expect(capture).toHaveBeenCalledTimes(2); expect(saved).toHaveBeenCalledOnce(); expect(closed).toHaveBeenCalledOnce()
    expect(document.querySelector('textarea')!.value).toBe('')
  })

  it('prevents duplicate captures while the first save is pending', async () => {
    let resolve!: (text: string) => void
    const save = vi.fn(() => new Promise<string>(r => { resolve = r }))
    ;(window as any).sb = { brainCapture: save }
    await mount(<Capture value="Texto sintético para guardar" onChange={() => {}} onClose={() => {}} onSaved={() => {}} />)
    const form = document.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(save).toHaveBeenCalledOnce(); expect(button('Salvando…').disabled).toBe(true)
    await act(async () => resolve('Guardado'))
  })

  it('distinguishes search failure from no matches and ignores late answers', async () => {
    let late!: (value: unknown) => void
    const search = vi.fn((q: string) => q === 'antiga' ? new Promise(r => { late = r }) : q === 'nova' ? Promise.resolve({ hits: [{ path: 'notes/nova.md', title: 'Nova fonte', snippet: 'Atual' }] }) : Promise.reject(new Error('offline')))
    ;(window as any).sb = { brainSearch: search }
    await mount(<Memory compact />)
    const input = document.querySelector('input')!
    await type(input, 'falha'); await flush(210)
    expect(document.body.textContent).toContain('não pôde ser consultada')
    expect(document.body.textContent).not.toContain('Nenhuma memória encontrada')
    await type(input, 'antiga'); await flush(210)
    await type(input, 'nova'); await flush(210)
    await act(async () => late({ hits: [{ path: 'notes/antiga.md', title: 'Fonte atrasada' }] }))
    expect(document.body.textContent).toContain('Nova fonte'); expect(document.body.textContent).not.toContain('Fonte atrasada')
  })

  it('opens a full source past 4000 characters and preserves a failed correction', async () => {
    const content = `# Fonte sintética\n\n${'Conteúdo preservado. '.repeat(250)}\nMARCADOR_FINAL_COMPLETO`
    const correction = vi.fn().mockRejectedValueOnce(new Error('write failed')).mockResolvedValue('Correção registrada')
    ;(window as any).sb = { brainListMemory: async () => [], brainMemoryFile: async () => content, brainCorrect: correction }
    await mount(<Memory initialRequest={{ id: 1, path: 'notes/fonte.md' }} />)
    expect(document.body.textContent).toContain('MARCADOR_FINAL_COMPLETO')
    await click(button('Corrigir um fato'))
    const fields = document.querySelectorAll('textarea')
    await type(fields[0], 'Fato anterior com contexto completo'); await type(fields[1], 'Informação correta')
    await click(button('Salvar correção'))
    expect(fields[0].value).toBe('Fato anterior com contexto completo'); expect(fields[1].value).toBe('Informação correta')
    expect(document.body.textContent).toContain('textos foram mantidos')
    await click(button('Salvar correção')); expect(document.body.textContent).toContain('histórico foi preservado')
  })

  it('preserves a correction draft across background refreshes and source navigation', async () => {
    ;(window as any).sb = { brainListMemory: async () => [{ path: 'notes/fonte.md', content: '# Fonte' }], brainMemoryFile: async () => '# Fonte' }
    await mount(<Memory refreshToken={0} initialRequest={{ id: 1, path: 'notes/fonte.md' }} />)
    await click(button('Corrigir um fato'))
    await type(document.querySelectorAll('textarea')[0], 'Fato original completo')
    await type(document.querySelectorAll('textarea')[1], 'Correção que não pode sumir')
    await act(async () => root!.render(<Memory refreshToken={1} initialRequest={{ id: 1, path: 'notes/fonte.md' }} />)); await flush()
    expect(document.querySelectorAll('textarea')[1].value).toBe('Correção que não pode sumir')
    await click(button('← Resultados'))
    await click(document.querySelector('.memory-result')!)
    expect(document.querySelectorAll('textarea')[0].value).toBe('Fato original completo')
    expect(document.querySelectorAll('textarea')[1].value).toBe('Correção que não pode sumir')
  })

  it('does not interpret a malformed search response as an empty memory', async () => {
    ;(window as any).sb = { brainSearch: async () => undefined }
    await mount(<Memory compact />)
    await type(document.querySelector('input')!, 'consulta'); await flush(210)
    expect(document.body.textContent).toContain('não pôde ser consultada')
    expect(document.body.textContent).not.toContain('Nenhuma memória encontrada')
  })
})

describe('modal keyboard and safe source rendering', () => {
  it('traps focus, makes the application inert, and restores the opener', async () => {
    const surface = document.createElement('div'); surface.id = 'app-surface'
    const opener = document.createElement('button'); opener.textContent = 'Abrir'; surface.append(opener); document.body.append(surface); opener.focus()
    const close = vi.fn()
    await mount(<Dialog title="Teste" onClose={close}><input data-autofocus /><details><summary>Detalhes</summary><button>Oculto em detalhes</button></details><button>Último</button><div style={{ display: 'none' }}><button>Oculto por CSS</button></div></Dialog>)
    expect(surface.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(document.querySelector('input'))
    const last = button('Último'); last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Fechar janela')
    document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(close).toHaveBeenCalledOnce()
    await act(async () => root!.unmount()); root = undefined
    expect(surface.hasAttribute('inert')).toBe(false); expect(document.activeElement).toBe(opener)
  })

  it('escapes attribute quotes in source links instead of allowing event handlers', () => {
    const host = document.createElement('div')
    host.innerHTML = mdToHtml('[texto](https://example.com/"onmouseover="alert(1))')
    expect(host.querySelector('a')?.getAttribute('onmouseover')).toBeNull()
    expect(host.querySelectorAll('script')).toHaveLength(0)
  })
})
