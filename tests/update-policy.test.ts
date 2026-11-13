import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { selectUpdate, validateUpdateAsset, macSwapScript, updateIdentity } from '../src/main/services/update-policy'
const asset = (name: string, repo = 'keepmind') => ({ name, size: 123, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: `https://github.com/criptogus/${repo}/releases/download/continuous/${name}` })
describe('installed update boundaries', () => {
  it('keeps Corp on its own repository and excludes personal binaries', () => {
    expect(updateIdentity('corp').repo).toBe('criptogus/keepmind-corp')
    expect(selectUpdate([asset('KeepMind-0.2.6-universal-mac.zip')], 'corp', 'darwin', 'arm64', '0.2.6')).toBeUndefined()
    expect(selectUpdate([asset('KeepMind-Corp-0.2.6-universal-mac.zip')], 'corp', 'darwin', 'arm64', '0.2.6')?.name).toContain('Corp')
  })
  it('never downgrades and rejects another architecture', () => {
    expect(selectUpdate([asset('KeepMind-0.2.5-universal-mac.zip')], 'personal', 'darwin', 'arm64', '0.2.6')).toBeUndefined()
    expect(selectUpdate([asset('KeepMind-0.2.6-x64-mac.zip')], 'personal', 'darwin', 'arm64', '0.2.6')).toBeUndefined()
  })
  it('requires trusted URL, positive size and digest', () => {
    const valid = asset('KeepMind-Setup-0.2.6.exe')
    expect(validateUpdateAsset(valid,'personal').size).toBe(123)
    for(const patch of [{digest:undefined},{size:0},{browser_download_url:'https://example.com/update.exe'}]) expect(()=>validateUpdateAsset({...valid,...patch},'personal')).toThrow()
    expect(()=>validateUpdateAsset(valid,'corp')).toThrow()
  })
  it('swaps an app transactionally and preserves a quoted profile without shell expansion', () => {
    const dir = mkdtempSync(join(tmpdir(),'km-swap-'))
    try {
      const target=join(dir,"KeepMind's $(touch BAD).app"),stage=join(dir,'staged.app'),profile=join(dir,'private profile'),result=join(dir,'result')
      mkdirSync(target);writeFileSync(join(target,'old'),'old');mkdirSync(stage);mkdirSync(profile);writeFileSync(join(profile,'sentinel'),'keep')
      const exe=join(target,'launch');writeFileSync(join(stage,'launch'),`#!/bin/bash\nprintf '%s' "$1" > '${result}'\n`,{mode:0o755})
      execFileSync('bash',['-c',macSwapScript(target,stage,exe,profile,99999999)])
      expect(readFileSync(join(profile,'sentinel'),'utf8')).toBe('keep')
      expect(existsSync(join(target+'.previous','old'))).toBe(true)
      expect(existsSync(join(target,'launch'))).toBe(true)
      expect(existsSync(join(dir,'BAD'))).toBe(false)
    } finally { rmSync(dir,{recursive:true,force:true}) }
  })
  it('leaves the previous installation intact if staging is missing', () => {
    const dir=mkdtempSync(join(tmpdir(),'km-swap-'));const target=join(dir,'KeepMind.app');mkdirSync(target);writeFileSync(join(target,'old'),'intact')
    try {expect(()=>execFileSync('bash',['-c',macSwapScript(target,join(dir,'missing'),'/unused','/unused',99999999)])).toThrow();expect(readFileSync(join(target,'old'),'utf8')).toBe('intact')}finally{rmSync(dir,{recursive:true,force:true})}
  })
})
