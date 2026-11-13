import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

// Do not close the application until the external installer can take over.
export function waitForHelperStart(child: ChildProcess, readyFile: string, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearInterval(poll)
      clearTimeout(deadline)
      child.removeListener('exit', exited)
      child.removeListener('error', failed)
      error ? reject(error) : resolve()
    }
    const exited = (code: number | null, signal: string | null) => finish(new Error(`Update helper exited before startup (code ${code}, signal ${signal})`))
    const failed = (error: Error) => finish(error)
    const poll = setInterval(() => { if (existsSync(readyFile)) finish() }, 50)
    const deadline = setTimeout(() => { child.kill(); finish(new Error('Update helper startup timed out')) }, timeoutMs)
    child.once('exit', exited)
    child.once('error', failed)
    if (child.exitCode !== null || child.signalCode !== null) exited(child.exitCode, child.signalCode)
    else if (existsSync(readyFile)) finish()
  })
}
