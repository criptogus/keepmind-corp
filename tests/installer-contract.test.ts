import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const {load}=createRequire(import.meta.url)('js-yaml')
it('preserves profiles on Windows uninstall for both editions',()=>{
  for(const file of ['electron-builder.yml','electron-builder.corp.yml'])expect(load(readFileSync(file,'utf8')).nsis.deleteAppDataOnUninstall).toBe(false)
})
it('publishes the Corp desktop entrypoint/resources instead of the personal application',()=>{
  const corp=load(readFileSync('electron-builder.corp.yml','utf8'))
  expect(corp.extraMetadata.main).toBe('./out/main/index-corp.js')
  expect(corp.files).toContain('out/main/**')
  expect(corp.publish.repo).toBe('keepmind-corp')
  const flow=load(readFileSync('.github/workflows/continuous.yml','utf8'))
  const steps=flow.jobs.build.steps
  expect(steps.find((s:any)=>s.run?.startsWith('npx electron-builder')).run).toContain("github.repository == 'criptogus/keepmind-corp' && '--config electron-builder.corp.yml'")
  expect(steps.some((s:any)=>s.run==='npm run corp:build-brain' && s.if.includes('keepmind-corp'))).toBe(true)
  expect(steps.find((s:any)=>s.uses?.startsWith('actions/upload-artifact')).with.path).toContain("'dist-corp' || 'dist'")
})
