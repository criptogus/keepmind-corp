import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ProposalDecisions} from '../backend/proposal-decisions.mjs';
import {attentionDeliveries} from '../backend/proposals.mjs';
test('decisions survive reload, suppress equivalent future jobs and can be undone without modifying history',()=>{
 const dir=mkdtempSync(join(tmpdir(),'km-decisions-'));try{
 const file=join(dir,'decisions.json'),store=new ProposalDecisions(file);
 const job={id:'original',status:'done',startedAt:new Date().toISOString(),result:{summary:'Proposta',learning:{body:'Separar fatos de hipóteses na revisão',purpose:'Evitar conclusões sem evidências'},skill:{name:'Revisar evidências',steps:['Conferir fontes antes da conclusão']}}};
 const before=JSON.stringify(job);store.set(job,'dismissed');const restored=new ProposalDecisions(file),future={...job,id:'future'};
 expect(restored.find(future.result).status).toBe('dismissed');expect(attentionDeliveries({jobs:[{...future,proposalDecision:restored.find(future.result)}]})).toEqual([]);
 restored.set(future,'resolved');expect(new ProposalDecisions(file).find(job.result).status).toBe('resolved');
 restored.set(future,'accepted');expect(new ProposalDecisions(file).find(job.result).status).toBe('accepted');expect(attentionDeliveries({jobs:[{...future,proposalDecision:restored.find(future.result)}]})).toEqual([]);
 restored.set(job,'open');expect(new ProposalDecisions(file).find(job.result)).toBeUndefined();expect(JSON.stringify(job)).toBe(before);
 expect(()=>store.set(job,'invalid')).toThrow();expect(()=>store.set({...job,status:'running'},'dismissed')).toThrow();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
