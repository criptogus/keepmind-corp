import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/services/llm', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/main/services/llm')>()),
  chatLive: vi.fn()
}))
import { chatLive } from '../src/main/services/llm'
import { AsyncLocalStorage } from 'node:async_hooks'
import { BrainContext } from '../src/main/services/brain/context'

describe('chat cancellation', () => {
  it('stops waiting for provider startup without generating or saving later', async () => {
    const controller = new AbortController()
    let ready!: () => void
    const append = vi.fn()
    const brain = Object.create(BrainContext.prototype)
    Object.assign(brain, { turnStorage: new AsyncLocalStorage<string[]>(), memory: { append }, ensureProviderReady: () => new Promise<void>(resolve => { ready = resolve }) })
    const before = vi.mocked(chatLive).mock.calls.length
    const pending = brain.chat('a', 'hello', undefined, undefined, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
    ready(); await Promise.resolve()
    expect(vi.mocked(chatLive).mock.calls).toHaveLength(before)
    expect(append).not.toHaveBeenCalled()
  })
  it('does not run further tools or save a final response after cancellation during a tool', async () => {
    const controller = new AbortController()
    const append = vi.fn()
    let finishTool!: (value: string) => void
    const execTool = vi.fn(() => new Promise<string>(resolve => { finishTool = resolve }))
    const brain = Object.create(BrainContext.prototype)
    Object.assign(brain, {
      turnStorage: new AsyncLocalStorage<string[]>(), memory: { append, scopePath: (path: string) => path },
      ensureProviderReady: async () => {}, gitSync: null, rag: null,
      store: { get: () => ({ ai: { provider: 'local' }, agents: [{ id: 'a', name: 'A' }] }) },
      buildSystemContext: () => '', recentTurns: () => [], toolDefinitions: () => [], execTool,
      localLlm: null, note: vi.fn()
    })
    vi.mocked(chatLive).mockResolvedValueOnce({ text: '', toolCalls: [
      { id: '1', name: 'first', arguments: {} }, { id: '2', name: 'second', arguments: {} }
    ] })
    const pending = brain.chat('a', 'hello', undefined, undefined, controller.signal)
    await vi.waitFor(() => expect(execTool).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toThrow()
    finishTool('done')
    await Promise.resolve()
    expect(execTool).toHaveBeenCalledOnce()
    expect(chatLive).toHaveBeenCalledOnce()
    expect(append).not.toHaveBeenCalled()
  })
  it('keeps late tool writes in their original turn after a cancelled turn is replaced', async () => {
    const controller = new AbortController(); let finishTool!: () => void; let finishReply!: (result: any) => void
    const brain = Object.create(BrainContext.prototype)
    Object.assign(brain, {
      turnStorage: new AsyncLocalStorage<string[]>(), memory: { append: vi.fn(), scopePath: (path: string) => path },
      ensureProviderReady: async () => {}, gitSync: null, rag: null,
      store: { get: () => ({ ai: { provider: 'local' }, agents: [{ id: 'a', name: 'A' }] }) },
      buildSystemContext: () => '', recentTurns: () => [], toolDefinitions: () => [], localLlm: null, note: vi.fn(),
      execTool: async () => { await new Promise<void>(resolve => { finishTool = resolve }); brain.turnSaved.push('late-first-turn.md'); return 'done' }
    })
    vi.mocked(chatLive).mockReset().mockResolvedValueOnce({ text: '', toolCalls: [{ id: '1', name: 'save', arguments: {} }] }).mockImplementationOnce(() => new Promise(resolve => { finishReply = resolve }))
    const first = brain.chat('a', 'first', undefined, undefined, controller.signal)
    await vi.waitFor(() => expect(finishTool).toBeTypeOf('function'))
    controller.abort(); await expect(first).rejects.toThrow()
    const second = brain.chat('a', 'second')
    await vi.waitFor(() => expect(finishReply).toBeTypeOf('function'))
    finishTool(); await Promise.resolve(); await Promise.resolve()
    finishReply({ text: 'second reply', toolCalls: [] })
    const result = await second
    expect(result.saved).toEqual([])
  })

})
