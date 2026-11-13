// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../src/renderer/src/components/NeuralField', () => ({ default: () => null }))
vi.mock('../src/renderer/src/components/Today', () => ({ default: ({ onNavigate }: any) => <div><button onClick={() => onNavigate('projects', { projectId: 'synthetic-project' })}>Abrir projeto sintético</button></div> }))
vi.mock('../src/renderer/src/components/Projects', () => ({ default: ({ initialProjectId }: any) => <div>Projeto aberto: {initialProjectId}</div> }))
vi.mock('../src/renderer/src/components/Chat', () => ({ default: ({ onOpenMemory }: any) => { const [draft, setDraft] = useState(''); return <div><label>Rascunho de conversa<input value={draft} onChange={e => setDraft(e.target.value)} /></label><button onClick={() => onOpenMemory('notes/synthetic.md')}>Abrir fonte sintética</button></div> } }))
vi.mock('../src/renderer/src/components/Memory', () => ({ default: ({ initialRequest }: any) => <div>Memória aberta: {initialRequest?.path}</div> }))
vi.mock('../src/renderer/src/components/Relationships', () => ({ default: () => <div>Relacionamentos sintéticos</div> }))
vi.mock('../src/renderer/src/components/Automations', () => ({ default: () => <div>Rotinas sintéticas</div> }))
vi.mock('../src/renderer/src/components/Settings', () => ({ default: () => <div>Configurações sintéticas</div> }))
import App from '../src/renderer/src/App'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let unmount: (() => void) | undefined
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
const click = async (element: Element | undefined | null) => { expect(element).toBeTruthy(); await act(async () => (element as HTMLElement).click()); await flush() }
const findButton = (name: string) => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent?.trim()) === name && !b.closest('[hidden]'))
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
afterEach(() => { if (unmount) act(unmount); unmount = undefined; document.body.innerHTML = '' })
it('navigates primary views and tools, preserves capture and chat drafts, and opens project and source links', async () => {
  ;(window as any).sb = { getConfig: async () => ({ onboardingDone: true, ai: { provider: 'test' } }), authState: async () => ({ user: { id: 'synthetic' } }), memorySecurityStatus: async () => ({ space: 'personal' }), automationPending: async () => [] }
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); unmount = () => root.unmount(); await act(async () => root.render(<App />)); await flush()
  await click(findButton('Abrir projeto sintético')); expect(document.body.textContent).toContain('Projeto aberto: synthetic-project')
  await click(findButton('Conversar')); await type(document.querySelector('label input')!, 'Rascunho preservado')
  await click(findButton('Memória')); await click(findButton('Relacionamentos')); expect(document.body.textContent).toContain('Relacionamentos sintéticos'); await click(findButton('Ferramentas e configurações')); await click(findButton('RotinasConfigure as tarefas recorrentes dos seus agentes.→')); expect(document.body.textContent).toContain('Rotinas sintéticas')
  await click(findButton('Conversar')); expect((document.querySelector('label input') as HTMLInputElement).value).toBe('Rascunho preservado')
  await click(findButton('Abrir fonte sintética')); expect(document.body.textContent).toContain('Memória aberta: notes/synthetic.md')
  await click(findButton('Hoje')); await click(findButton('KeepMind — início'))
  await click(findButton('Ferramentas e configurações')); await click(findButton('ConfiguraçõesAparência, modelo, sincronização e conta.→')); expect(document.body.textContent).toContain('Configurações sintéticas')
  await click(findButton('Capturar')); const capture = document.querySelector('textarea')!; await type(capture, 'Ideia sintética'); await click(findButton('Continuar depois')); await click(findButton('Capturar')); expect(document.querySelector('textarea')?.value).toBe('Ideia sintética')
})
it('keeps the browser CRM preview explicitly read-only', async () => {
  delete (window as any).sb
  const { installBrowserShim } = await import('../src/renderer/src/browserShim')
  installBrowserShim()
  const snapshot = await (window.sb as any).crm('snapshot', {})
  expect(snapshot.capabilities.canWrite).toBe(false)
  expect(snapshot.capabilities.canSend).toBe(false)
  expect(snapshot.insights[0].text).toContain('Prévia')
  await expect((window.sb as any).crm('create_contact', { name: 'Teste' })).rejects.toThrow('somente para leitura')
  await expect((window.sb as any).crm('send_draft', { draftId: 'synthetic' })).rejects.toThrow('somente para leitura')
})
