// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import Today from '../src/renderer/src/components/Today'
import Wizard from '../src/renderer/src/components/Wizard'
vi.mock('../src/renderer/src/components/KeepMindAvatar', () => ({ default: () => null }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
const click = async (text: string) => { expect(button(text)).toBeTruthy(); await act(async () => { button(text).click() }); await flush() }
const mount = async (element: React.ReactNode) => { const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node); await act(async () => root.render(element)); await flush() }
afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })
it('keeps failed decisions distinct from empty and retries, then resumes the recent project', async () => {
  let fail = true
  const navigate = vi.fn()
  ;(window as any).sb = { continuity: async () => [{ id:'p', title:'Projeto', objective:'Objetivo', nextStep:'Próximo', status:'active', updatedAt:'2026-01-01' }], automationPending: async () => { if (fail) throw Error('offline'); return [] }, brainFacts: async () => [], brainPolicy: async () => null, brainLedger: async () => [], brainHealth: async () => null, brainListSleep: async () => [], brainEval: async () => null, onJob: () => () => {} }
  await mount(<Today onNavigate={navigate} />)
  expect(document.body.textContent).toContain('aprovações de automação')
  expect(document.body.textContent).not.toContain('Nenhuma decisão pendente agora.')
  fail = false; await click('Tentar novamente')
  expect(document.body.textContent).toContain('Nenhuma decisão pendente agora.')
  await click('Retomar projeto'); expect(navigate).toHaveBeenCalledWith('projects', { projectId: 'p' })
})
it('saves a first capture without AI and continues to the source', async () => {
  const done = vi.fn(); const updateAi = vi.fn(); const capture = vi.fn().mockRejectedValueOnce(Error('disco indisponível')).mockResolvedValue('Frase guardada.')
  ;(window as any).sb = { localLlmStatus: async () => ({}), aiCodexStatus: async () => ({}), onLocalLlmProgress: () => () => {}, brainCapture: capture, setConfig: async () => {}, aiProviders: async () => [], aiTest: async () => ({ok:false,error:'Provedor indisponível'}), updateAi }
  await mount(<Wizard config={{}} onDone={done} onToast={() => {}} />)
  await click('Começar →'); await click('OpenAI'); await click('Configurar e continuar'); expect(document.body.textContent).toContain('Provedor indisponível'); expect(updateAi).not.toHaveBeenCalled(); await click('Configurar depois')
  const input = document.querySelector('textarea')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Prefiro manhãs tranquilas'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(button('Fazer isso depois')).toBeUndefined(); await click('Voltar'); await click('Configurar depois'); expect(document.querySelector('textarea')!.value).toBe('Prefiro manhãs tranquilas')
  await click('Guardar ideia'); expect(document.body.textContent).toContain('disco indisponível'); expect(document.querySelector('textarea')!.value).toBe('Prefiro manhãs tranquilas'); expect(done).not.toHaveBeenCalled()
  await click('Guardar ideia'); expect(document.body.textContent).toContain('Sua ideia foi guardada')
  await click('Ver fonte ou corrigir'); expect(done).toHaveBeenCalledWith({ view:'graph', path:'long-term/facts.md' })
})
