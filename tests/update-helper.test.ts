import { it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { waitForHelperStart } from '../src/main/services/update-helper'

it('requires the installer helper startup signal before allowing app shutdown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'km-helper-')), ready = join(root, 'ready')
  const child = spawn(process.execPath, ['-e', "require('fs').writeFileSync(process.argv[1], 'ready'); setInterval(()=>{},1000)", ready])
  try { await expect(waitForHelperStart(child, ready)).resolves.toBeUndefined() }
  finally { child.kill(); rmSync(root, { recursive: true, force: true }) }
})
it('rejects a helper that exits without starting instead of closing the app', async () => {
  const root = mkdtempSync(join(tmpdir(), 'km-helper-'))
  const child = spawn(process.execPath, ['-e', 'process.exit(17)'])
  try { await expect(waitForHelperStart(child, join(root, 'ready'))).rejects.toThrow('code 17') }
  finally { rmSync(root, { recursive: true, force: true }) }
})
