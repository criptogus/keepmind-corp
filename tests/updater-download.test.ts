import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
const fake=vi.hoisted(()=>({profile:'',fetch:vi.fn(),send:vi.fn()}))
vi.mock('electron',()=>({app:{isPackaged:true,getPath:()=>fake.profile,getVersion:()=> '0.2.6'},BrowserWindow:{getAllWindows:()=>[{webContents:{send:fake.send}}]},net:{fetch:fake.fetch}}))
vi.mock('electron-updater',()=>({autoUpdater:{on:vi.fn()}}))
beforeEach(()=>{vi.resetModules();fake.profile=mkdtempSync(join(tmpdir(),'km-update-'));fake.fetch.mockReset();fake.send.mockReset();writeFileSync(join(fake.profile,'continuous-state.json'),JSON.stringify({seen:'previous-build'}))})
afterEach(()=>{vi.useRealTimers();rmSync(fake.profile,{recursive:true,force:true})})
const bytes=Buffer.from('synthetic update bytes'),digest='sha256:'+createHash('sha256').update(bytes).digest('hex')
const name=process.platform==='darwin'?'KeepMind-0.2.6-universal-mac.zip':process.platform==='win32'?'KeepMind-Setup-0.2.6.exe':'KeepMind-0.2.6.AppImage'
const url='https://github.com/criptogus/keepmind/releases/download/continuous/'+name
function responses(body:Buffer){fake.fetch.mockImplementation(async(input:string)=>input.includes('api.github.com')?Response.json({updated_at:'2026-11-13',assets:[{name,browser_download_url:url,digest,size:bytes.length}]}):new Response(body))}
it('downloads verified bytes and restores a pending update after restarting without consuming its marker',async()=>{
  responses(bytes);let updater=await import('../src/main/services/updater');expect((await updater.checkForUpdates()).continuous).toBe('0.2.6')
  expect(readFileSync(join(fake.profile,'continuous-state.json'),'utf8')).toContain('previous-build')
  expect(existsSync(join(fake.profile,'update','pending.json'))).toBe(true)
  vi.resetModules();updater=await import('../src/main/services/updater');fake.fetch.mockClear()
  expect((await updater.checkForUpdates()).continuous).toBe('0.2.6');expect(fake.fetch).not.toHaveBeenCalled()
})
it('rejects corrupt downloads before offering installation',async()=>{
  responses(Buffer.from('tampered'));const updater=await import('../src/main/services/updater');expect((await updater.checkForUpdates()).error).toContain('integrity')
  expect(existsSync(join(fake.profile,'update','pending.json'))).toBe(false)
  expect(existsSync(join(fake.profile,'update',name))).toBe(false)
})
it('rejects tampered pending files after restart',async()=>{
  responses(bytes);let updater=await import('../src/main/services/updater');await updater.checkForUpdates();writeFileSync(join(fake.profile,'update',name),'tampered')
  vi.resetModules();updater=await import('../src/main/services/updater');expect((await updater.checkForUpdates()).error).toContain('integrity')
})
it('Corp updater requests the Corp repository and does not accept personal packages',async()=>{
  responses(bytes);vi.useFakeTimers();const updater=await import('../src/main/services/updater');updater.initUpdater({edition:'corp'});await updater.checkForUpdates()
  expect(fake.fetch.mock.calls[0][0]).toContain('/criptogus/keepmind-corp/');expect(existsSync(join(fake.profile,'update','pending.json'))).toBe(false)
})
