import { it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readNewDebugPort } from '../scripts/packaged-test-support.mjs'
it('waits through a truncated or partial Chromium endpoint file during relaunch', () => {
  const root = mkdtempSync(join(tmpdir(), 'km-cdp-')), file = join(root, 'DevToolsActivePort')
  const previous = '1234\n/devtools/browser/old'
  try {
    for (const contents of ['', '5678', '5678\n', previous]) {
      writeFileSync(file, contents)
      expect(readNewDebugPort(file, previous)).toBeNull()
    }
    writeFileSync(file, '5678\n/devtools/browser/new')
    expect(readNewDebugPort(file, previous)).toBe(5678)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
