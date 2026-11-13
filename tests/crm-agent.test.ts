import { expect, it, vi } from 'vitest'
import { crmAgentResult } from '../tools/lib/crm-tools.mjs'
import { BrainContext } from '../src/main/services/brain/context'

it('finds contacts beyond the first page without exposing unrelated notes or message bodies', () => {
  const contacts=Array.from({length:125},(_,i)=>({id:`contact-${i}`,name:`Pessoa ${i}`,notes:`Nota ${i}`,email:'',phone:'',role:'',tags:[],companyId:'',archivedAt:''}))
  contacts[124].name='João da Silva'; contacts[124].notes='Fonte privada da relação'
  const result={revision:1,space:'personal',contacts,commitments:[],opportunities:[],drafts:[],insights:[],duplicates:[],interactions:[],metrics:{}}
  expect(crmAgentResult(result).page).toEqual({matched:125,offset:0,limit:100,nextOffset:100})
  expect(crmAgentResult(result,{offset:100}).contacts).toHaveLength(25)
  const found=crmAgentResult(result,{query:'joao'})
  expect(found.contacts).toHaveLength(1); expect(found.contacts[0].id).toBe('contact-124')
  expect(found.contacts[0]).not.toHaveProperty('notes')
  expect(crmAgentResult(result,{query:'inexistente'}).page.matched).toBe(0)
})

it('does not expose or execute a raw WhatsApp transport as an agent policy bypass', async () => {
  const brain=Object.create(BrainContext.prototype) as any, callTool=vi.fn()
  Object.assign(brain,{mcp:{allTools:()=>['whatsapp_send','whatsapp_send_tracked','whatsapp_events','whatsapp_status'].map(name=>({serverId:'whatsapp',tool:{name,description:name,inputSchema:{type:'object'}}})),callTool}})
  const names=brain.toolDefinitions().map((t:any)=>t.name)
  expect(names).toContain('crm_send_message'); expect(names).toContain('mcp_whatsapp_whatsapp_status')
  for(const tool of ['whatsapp_send','whatsapp_send_tracked','whatsapp_events']) {
    expect(names).not.toContain(`mcp_whatsapp_${tool}`)
    expect(await brain.execTool(`mcp_whatsapp_${tool}`,{to:'5511999999999',text:'Teste sintético'})).toContain('CRM_ACTION_DENIED')
  }
  expect(callTool).not.toHaveBeenCalled()
})
