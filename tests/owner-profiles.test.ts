import {it,expect} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
// @ts-ignore standalone backend module
import {ownerProfiles} from '../apps/brain/backend/owner-profiles.mjs'
it('owner consent is required; restricted, secrets, symlinks and other folders stay denied',()=>{
 const root=mkdtempSync(join(tmpdir(),'km-profiles-'))
 try{
  mkdirSync(join(root,'People'));mkdirSync(join(root,'Companies'))
  writeFileSync(join(root,'People/A.md'),'---\nconfidentiality: confidential\n---\n# A')
  writeFileSync(join(root,'People/B.md'),'---\nconfidentiality: restricted\n---\n# B')
  writeFileSync(join(root,'People/C.md'),'sk-abcdefghijklmnopqrstuvwxyz')
  symlinkSync(join(root,'People/A.md'),join(root,'People/D.md'))
  expect(()=>ownerProfiles(root,false).list()).toThrow('not enabled')
  const service=ownerProfiles(root,true)
  expect(service.list()).toEqual(['People/A.md'])
  expect(service.read('People/A.md')).toContain('confidential')
  for(const path of ['People/B.md','People/C.md','People/D.md','People/../A.md','Other/A.md'])expect(()=>service.read(path)).toThrow()
 }finally{rmSync(root,{recursive:true,force:true})}
})
