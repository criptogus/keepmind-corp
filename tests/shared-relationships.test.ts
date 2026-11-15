import { describe, it, expect, vi } from 'vitest'
import { sharedRelationships } from '../src/main/shared-relationships'
describe('shared relationships',()=>{
 const index=[{path:'People/Ana.md'},{path:'People/INDEX.md'},{path:'Companies/Acme.md'},{path:'Meetings/Briefing.md'},{path:'Other/Briefing.md'}]
 it('uses canonical paths without importing or fetching all bodies',async()=>{
  const read=vi.fn().mockResolvedValue(index)
  const result=await sharedRelationships('snapshot',{},read)
  expect(result.contacts?.map(x=>x.id)).toEqual(['People/Ana.md','Companies/Acme.md'])
  expect(read.mock.calls).toEqual([['/notes']])
 })
 it('resolves explicit permitted sources, rejecting ambiguous and missing links',async()=>{
  const read=vi.fn(async(path:string)=>path==='/notes'?index:{body:'# Ana\n[[Companies/Acme]] [[Meetings/Briefing|Conversa]] [[Briefing]] [[Private/Secret]]'})
  const result:any=await sharedRelationships('profile',{path:'People/Ana.md'},read)
  expect(result.sources.map((x:any)=>x.path)).toEqual(['Companies/Acme.md','Meetings/Briefing.md'])
  expect(result.unavailable).toBe(2)
  expect(read).toHaveBeenCalledTimes(2)
 })
 it('rejects writes and profiles outside the authorized index',async()=>{
  const read=vi.fn().mockResolvedValue(index)
  await expect(sharedRelationships('create_contact',{},read)).rejects.toThrow('Nenhum cadastro paralelo')
  expect(read).not.toHaveBeenCalled()
  await expect(sharedRelationships('profile',{path:'People/Hidden.md'},read)).rejects.toThrow('indisponível')
  expect(read).toHaveBeenCalledTimes(1)
 })
})
