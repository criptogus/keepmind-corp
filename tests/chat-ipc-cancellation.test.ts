import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>())
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => handlers.set(name, callback) },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  app: { getPath: () => '/tmp', getVersion: () => 'test', isPackaged: false },
  shell: {}, safeStorage: {}, dialog: {}, Notification: class {}
}))
import { registerIpc } from '../src/main/ipc'
class Sender extends EventEmitter {
  constructor(readonly id: number) { super() }
  send = vi.fn()
  isDestroyed() { return false }
}
it('isolates cancellation by sender and request, rejects overlap, cleans up, and tags events', async () => {
  const memory = {} as any
  const brain = { getMemory: () => memory, setActivitySource: vi.fn(), chat: vi.fn(async (_a, _m, delta, step, signal: AbortSignal) => {
    delta('fragment'); step('thinking')
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  }) }
  registerIpc({ get: () => ({}) } as any, brain as any, null, null)
  const first = new Sender(1), second = new Sender(2)
  const call = handlers.get('brain:chat')!, cancel = handlers.get('brain:cancel')!
  const pending = call({ sender: first }, 'agent', 'hello', 'one')
  expect(first.send).toHaveBeenCalledWith('brain:delta', 'fragment', 'one')
  expect(first.send).toHaveBeenCalledWith('brain:step', 'thinking', 'one')
  expect(cancel({ sender: second }, 'one')).toBe(false)
  expect(cancel({ sender: first }, 'wrong')).toBe(false)
  await expect(call({ sender: first }, 'agent', 'other', 'two')).rejects.toThrow('CHAT_ALREADY_RUNNING')
  expect(cancel({ sender: first }, 'one')).toBe(true)
  await expect(pending).rejects.toThrow('CHAT_CANCELLED')
  expect(cancel({ sender: first }, 'one')).toBe(false)
  expect(first.send.mock.calls.some(([channel, event]) => channel === 'brain:job' && event.phase === 'done')).toBe(false)
  expect(first.listenerCount('destroyed')).toBe(0)
})
it('aborts a request when its sender is destroyed and allows a fresh request after cleanup', async () => {
  const brain = { getMemory: () => ({}), setActivitySource: vi.fn(), chat: vi.fn(async (_a, _m, _delta, _step, signal: AbortSignal) => {
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  }) }
  registerIpc({ get: () => ({}) } as any, brain as any, null, null)
  const sender = new Sender(3); const call = handlers.get('brain:chat')!
  const pending = call({ sender }, 'agent', 'hello', 'one')
  sender.emit('destroyed')
  await expect(pending).rejects.toThrow('CHAT_CANCELLED')
  const next = call({ sender }, 'agent', 'hello', 'two')
  expect(handlers.get('brain:cancel')!({ sender }, 'two')).toBe(true)
  await expect(next).rejects.toThrow('CHAT_CANCELLED')
})
