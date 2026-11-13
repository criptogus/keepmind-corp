import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chat, completionIdentity } from '../src/main/services/llm'
import { configureEgressContext } from '../src/main/services/security/egress'
const dirs: string[] = []
afterEach(() => { vi.unstubAllGlobals(); configureEgressContext(() => ({})); dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})) })
it('propagates the sixth argument signal to fetch and aborts active requests', async () => {
  const dir = mkdtempSync(join(tmpdir(),'km-cancel-')); dirs.push(dir)
  configureEgressContext(()=>({logFile:join(dir,'egress.jsonl')}))
  const fetcher = vi.fn((_url,init) => new Promise((_resolve,reject) => { init.signal.addEventListener('abort',()=>reject(new Error('aborted'))) }))
  vi.stubGlobal('fetch',fetcher)
  const controller = new AbortController()
  const pending = chat({provider:'openai',apiKey:'synthetic',model:'gpt-4o'},[{role:'user',content:'hello'}],[],undefined,{logFile:join(dir,'egress.jsonl')},controller.signal)
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal)
  controller.abort(); await expect(pending).rejects.toThrow('aborted')
})
it('makes no request when already aborted', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher)
  const controller = new AbortController(); controller.abort()
  await expect(chat({provider:'openai',apiKey:'synthetic'},[{role:'user',content:'hello'}],[],undefined,{},controller.signal)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it('reports the same custom Ollama model that is sent to the provider', async () => {
  const dir = mkdtempSync(join(tmpdir(),'km-model-')); dirs.push(dir)
  configureEgressContext(()=>({logFile:join(dir,'egress.jsonl')}))
  const fetcher = vi.fn(async () => new Response(JSON.stringify({message:{content:'synthetic answer'}}), {status:200}))
  vi.stubGlobal('fetch',fetcher)
  const config = {provider:'ollama',model:'user-model:custom-quantization'}
  await chat(config,[{role:'user',content:'synthetic question'}])
  const request = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
  expect(completionIdentity(config)).toEqual({provider:'ollama',model:request.model})
  expect(request.model).toBe('user-model:custom-quantization')
})
it('aborts an active local stream without falling back to a second completion', async () => {
  const { chatLive } = await import('../src/main/services/llm')
  const controller = new AbortController()
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({ start(streamController) {
      streamController.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Olá"}}]}\n'))
      init.signal!.addEventListener('abort', () => streamController.error(new Error('stream aborted')))
    } })
    return new Response(stream, { status: 200 })
  })
  vi.stubGlobal('fetch', fetcher)
  const delta = vi.fn(() => controller.abort())
  await expect(chatLive({ provider: 'local' }, [{ role: 'user', content: 'teste' }], [], delta, undefined, controller.signal)).rejects.toThrow()
  expect(delta).toHaveBeenCalledWith('Olá')
  expect(fetcher).toHaveBeenCalledOnce()
  expect((fetcher.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
})
