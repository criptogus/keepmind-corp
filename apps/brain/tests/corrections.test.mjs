import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {McpClient} from '../backend/mcp-client.mjs';
test('correction crosses clients only after review; scoped, bounded, revocable and revision checked',async()=>{
 const root=mkdtempSync(join(tmpdir(),'km-correction-'));let owner,agent,restricted;
 try{writeFileSync(join(root,'source.md'),'KeepMind proposal prepared does not mean applied.');const script=join(import.meta.dirname,'../backend/shared-mcp.mjs'),env={KEEPMIND_SHARED_VAULT:root,KEEPMIND_USAGE:'1'};
 owner=await new McpClient().start(process.execPath,[script],{...env,KEEPMIND_SHARED_OWNER:'1'});agent=await new McpClient().start(process.execPath,[script],{...env,KEEPMIND_SHARED_OWNER:'0'});
 const draft={path:'source.md',agent:'Codex',model:'fixture',before:'Ready means applied',after:'Prepared is not applied',quote:'proposal prepared does not mean applied',purpose:'Preserve execution status',intent:'handoff',matchTerms:['KeepMind']};
 await expect(agent.call('km_correction_propose',draft)).rejects.toThrow();await expect(owner.call('km_correction_propose',{...draft,quote:'absent'})).rejects.toThrow();
 const row=JSON.parse(await owner.call('km_correction_propose',draft));const context=async(query='KeepMind handoff',extra={})=>JSON.parse(await agent.call('sb_context',{query,...extra}));
 expect((await context()).corrections).toHaveLength(0);await owner.call('km_learning_approve',{id:row.id,approvalDigest:row.approvalDigest,approved:true});
 expect((await context()).corrections[0].author.agent).toBe('Codex');expect((await context('Other handoff')).corrections).toHaveLength(0);expect((await context('KeepMind',{intent:'task'})).corrections).toHaveLength(0);
 expect((await context('KeepMind handoff',{budget:500})).characters).toBeLessThanOrEqual(500);expect((await context('KeepMind handoff',{project:'Other'})).corrections).toHaveLength(0);
 restricted=await new McpClient().start(process.execPath,[script],{...env,KEEPMIND_ALLOWED_PATHS:JSON.stringify(['source.md'])});expect(JSON.parse(await restricted.call('sb_context',{query:'KeepMind handoff'})).corrections).toHaveLength(0);
 const receipt=JSON.parse(await agent.call('sb_task_start',{task:'KeepMind handoff',agent:'recipient',model:'fixture',mode:'keepmind'})).receipt;
 await owner.call('km_learning_suspend',{id:row.id});expect((await context()).corrections).toHaveLength(0);expect(JSON.parse(await agent.call('sb_task_context',{id:receipt.id})).needsRefresh).toBe(true);
 const second=JSON.parse(await owner.call('km_correction_propose',draft));await owner.call('km_learning_approve',{id:second.id,approvalDigest:second.approvalDigest,approved:true});writeFileSync(join(root,'source.md'),'Changed source');expect((await context()).corrections).toHaveLength(0);
 }finally{owner?.stop();agent?.stop();restricted?.stop();rmSync(root,{recursive:true,force:true})}
},20000);
