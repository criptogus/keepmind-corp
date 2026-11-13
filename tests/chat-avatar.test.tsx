// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Chat from '../src/renderer/src/components/Chat'
import { readAppearance, updateAppearance } from '../src/renderer/src/lib/appearance'

vi.mock('open-bot-avatar/dom', () => ({ mountAvatar: () => ({ update() {}, destroy() {} }) }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
const flush = async () => { await act(async () => { await Promise.resolve() }) }
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.innerHTML = ''; localStorage.clear(); vi.restoreAllMocks() })

describe('appearance and conversation', () => {
  it('stores device preferences and tolerates malformed storage', () => {
    localStorage.setItem('keepmind:appearance', '{broken')
    expect(readAppearance()).toEqual({ avatarEnabled: true, motionEnabled: true, backgroundEnabled: false })
    updateAppearance({ avatarEnabled: false, motionEnabled: false })
    expect(readAppearance().avatarEnabled).toBe(false)
    expect(readAppearance().motionEnabled).toBe(false)
  })
  it('offers the failed prompt for retry and does not call it a successful answer', async () => {
    let reject!: (error: Error) => void
    const call = vi.fn(() => new Promise((_resolve, rej) => { reject = rej }))
    ;(window as any).sb = { brainChat: call, onBrainDelta: () => () => {}, onBrainStep: () => () => {} }
    const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(<Chat initialPrompt={{ id: 1, text: 'Draft question' }} />) })
    expect(call).not.toHaveBeenCalled()
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Draft question')
    await act(async () => { (document.querySelector('[aria-label="Enviar mensagem"]') as HTMLButtonElement).click() })
    expect(call).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('Pensando')
    await act(async () => { reject(new Error('offline')); await Promise.resolve() })
    expect(document.body.textContent).toContain('Não foi possível concluir a resposta')
    expect(document.body.textContent).not.toContain("Turn logged to today's journal")
    const retry = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Recuperar mensagem para tentar novamente'))!
    await act(async () => { retry.click() }); await flush()
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Draft question')
  })
  it('filters events by request and waits for cancellation to settle', async () => {
    let reject!: (error: Error) => void
    let delta!: (text: string, id?: string) => void
    const call = vi.fn(() => new Promise((_resolve, rej) => { reject = rej }))
    const cancel = vi.fn(async () => true)
    ;(window as any).sb = { brainChat: call, brainCancel: cancel, onBrainDelta: (cb: typeof delta) => { delta = cb; return () => {} }, onBrainStep: () => () => {} }
    const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(<Chat initialPrompt={{ id: 1, text: 'Question' }} />) })
    await act(async () => { (document.querySelector('[aria-label="Enviar mensagem"]') as HTMLButtonElement).click() })
    const id = (call.mock.calls[0] as unknown as [string, string, string])[2]
    await act(async () => { delta('wrong response', 'another-id'); delta('partial', id) })
    expect(document.body.textContent).toContain('partial')
    expect(document.body.textContent).not.toContain('wrong response')
    await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Interromper')!.click() })
    expect(cancel).toHaveBeenCalledWith(id)
    expect(document.body.textContent).toContain('Interrompendo')
    await act(async () => { reject(new Error('CHAT_CANCELLED')); await Promise.resolve() })
    expect(document.body.textContent).toContain('Geração interrompida')
    expect(document.body.textContent).toContain('partial')
  })

  it('keeps an existing draft when a suggested prompt arrives', async () => {
    ;(window as any).sb = { brainChat: vi.fn(), onBrainDelta: () => () => {}, onBrainStep: () => () => {} }
    const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(<Chat initialPrompt={{ id: 1, text: 'First draft' }} />) })
    await act(async () => { root!.render(<Chat initialPrompt={{ id: 2, text: 'Suggested question' }} />) })
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('First draft')
    expect(document.body.textContent).toContain('Manter rascunho')
    await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Manter rascunho')!.click() })
    expect(textarea.value).toBe('First draft')
  })
  it('requires three characters and shows correction errors', async () => {
    localStorage.setItem('sb-chat:brain', JSON.stringify([{ role: 'assistant', content: 'An answer' }]))
    const correct = vi.fn(async () => { throw new Error('Save unavailable') })
    ;(window as any).sb = { brainCorrect: correct, onBrainDelta: () => () => {}, onBrainStep: () => () => {} }
    const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(<Chat />) })
    await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Corrigir um fato')!.click() })
    const fields = document.querySelectorAll('form textarea')
    const original = fields[0] as HTMLTextAreaElement
    const field = fields[1] as HTMLTextAreaElement
    expect(original.value).toBe('An answer')
    const change = async (value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })) })
    await change('ab')
    expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true)
    await change('abc')
    await act(async () => { (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    expect(correct).toHaveBeenCalledWith('An answer', 'abc')
    expect(document.body.textContent).toContain('Save unavailable')
    expect(field.value).toBe('abc')
  })

  it('stops an in-flight request on unmount and ignores later completion', async () => {
    let resolve!: (result: { text: string }) => void
    const cancel = vi.fn(async () => true)
    const call = vi.fn(() => new Promise(r => { resolve = r }))
    ;(window as any).sb = { brainChat: call, brainCancel: cancel, onBrainDelta: () => () => {}, onBrainStep: () => () => {} }
    const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(<Chat sessionKey="space-a" initialPrompt={{ id: 1, text: 'Pergunta' }} />) })
    await act(async () => { (document.querySelector('[aria-label="Enviar mensagem"]') as HTMLButtonElement).click() })
    const id = (call.mock.calls[0] as unknown as [string, string, string])[2]
    await act(async () => { root!.unmount(); root = undefined })
    expect(cancel).toHaveBeenCalledWith(id)
    await act(async () => { resolve({ text: 'Resposta tardia' }); await Promise.resolve() })
    expect(localStorage.getItem('sb-chat:brain:space-a') ?? '').not.toContain('Resposta tardia')
  })

  it.each([
    ['CORRECTION_NEEDS_FACT', 'Não encontramos um fato ativo'],
    ['CORRECTION_AMBIGUOUS', 'Há mais de um fato ativo']
  ])('explains %s without claiming a correction succeeded', async (code, message) => {
    localStorage.setItem('sb-chat:brain', JSON.stringify([{ role: 'assistant', content: 'Resposta inteira' }]))
    const correct = vi.fn(async () => { throw new Error(code) })
    const openMemory = vi.fn()
    ;(window as any).sb = { brainCorrect: correct, onBrainDelta: () => () => {}, onBrainStep: () => () => {} }
    const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(<Chat onOpenMemory={openMemory} />) })
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Corrigir um fato')!.click() })
    const [original, replacement] = [...host.querySelectorAll('form textarea')] as HTMLTextAreaElement[]
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(original, 'Fato exato'); original.dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(replacement, 'Fato corrigido'); replacement.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { (host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    expect(correct).toHaveBeenCalledWith('Fato exato', 'Fato corrigido')
    expect(host.textContent).toContain(message)
    expect(host.textContent).not.toContain('Fato corrigido.')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Consultar fonte')!.click() })
    expect(openMemory).toHaveBeenCalledWith('long-term/facts.md')
  })

})
