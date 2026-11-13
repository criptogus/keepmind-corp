import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => paths.userData } }))
import { ensureMcpServerScript } from '../src/main/services/scaffold'

afterEach(() => {
  if (paths.userData) rmSync(paths.userData, { recursive: true, force: true })
  paths.userData = ''
})

it('materializes an independently runnable MCP bundle with its shared modules', () => {
  paths.userData = mkdtempSync(join(tmpdir(), 'keepmind-scaffold-'))
  const entry = ensureMcpServerScript()
  expect(existsSync(join(dirname(entry), 'lib/memory-contract.mjs'))).toBe(true)
  expect(existsSync(join(dirname(entry), 'lib/continuity.mjs'))).toBe(true)
  for (const name of ['crm.mjs', 'crm-assistant.mjs', 'crm-tools.mjs']) expect(existsSync(join(dirname(entry), 'lib', name))).toBe(true)
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const {createMemoryServer} = await import(${JSON.stringify(pathToFileURL(entry).href)});
    const handle = createMemoryServer(${JSON.stringify(join(paths.userData, 'empty-vault'))});
    const reply = handle({id: 1, method: 'tools/list'});
    process.stdout.write(JSON.stringify(reply.result.tools.map(tool => tool.name)));
  `], { encoding: 'utf8', timeout: 10_000 })
  expect(child.error).toBeUndefined()
  expect(child.status, child.stderr).toBe(0)
  const tools: string[] = JSON.parse(child.stdout)
  expect(tools).toContain('continuity_context')
  expect(tools).toContain('crm_capture')
  expect(tools).not.toContain('crm_settings')
  expect(tools).not.toContain('crm_begin_delivery')
  expect(tools).toContain('sb_search')
  expect(tools).not.toContain('continuity_review_decision')
  expect(tools).not.toContain('continuity_feedback')
})
