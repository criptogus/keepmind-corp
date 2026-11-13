// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import Automations from '../src/renderer/src/components/Automations'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
it('shows a loading error instead of an empty routines list', async () => {
  ;(window as any).sb = {
    automationList: vi.fn().mockRejectedValue(new Error('offline')),
    automationPending: vi.fn().mockResolvedValue([]), brainActivity: vi.fn().mockResolvedValue([]),
    brainMemoryTiers: vi.fn().mockResolvedValue(null), brainListSleep: vi.fn().mockResolvedValue([]), syncStatus: vi.fn().mockResolvedValue(null)
  }
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host)
  await act(async () => { root.render(<Automations />); await Promise.resolve(); await Promise.resolve() })
  expect(document.body.textContent).toContain('Não foi possível carregar')
  expect(document.body.textContent).not.toContain('Nenhuma rotina cadastrada')
  expect([...document.querySelectorAll('button')].some(b => b.textContent === 'Tentar novamente')).toBe(true)
  act(() => root.unmount()); host.remove()
})
