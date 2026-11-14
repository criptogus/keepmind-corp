import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';
test('HTTP accept executes through real isolated MCP, reports reread and undo, without duplicate launch',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'km-accept-http-')),vault=join(dir,'vault'),state=join(dir,'state'),port=24175;
 mkdirSync(join(vault,'KeepMind-Bridge/notes'),{recursive:true});mkdirSync(state);
 const note=join(vault,'KeepMind-Bridge/notes/work.md');writeFileSync(note,'# Flow\nStop after error.');
 const original=join(vault,'original.md');writeFileSync(original,'Original read only.');
 const result={summary:'Replace stop with return to coordinator after error.',sourcePaths:['notes/work.md'],learning:{body:'Escalate impediments.',purpose:'Resume work.',sourcePath:'notes/work.md'},skill:{name:'Escalation',steps:['Return to coordinator'],checks:['Preserve source']}};
 writeFileSync(join(state,'ui-bridge-jobs.json'),JSON.stringify([{id:'proposal',status:'done',startedAt:new Date().toISOString(),result},{id:'protected',status:'done',result:{...result,sourcePaths:['original.md']}}]));
 const fake=join(dir,'planner');
 writeFileSync(fake,`#!/opt/homebrew/bin/bun
const prompt=await Bun.stdin.text();const protectedSource=prompt.includes('original.md');const target=protectedSource?'original.md':'notes/work.md';
const r=await fetch(process.env.KEEPMIND_BRIDGE_URL+'/internal/mcp',{method:'POST',headers:{Authorization:'Bearer '+process.env.KEEPMIND_JOB_TOKEN},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'sb_read',arguments:{path:target}}})});
if(!r.ok)process.exit(2);
const reply=await r.json();if(reply.result?.isError||reply.error)process.exit(3);
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'Added return to coordinator.',blockedReason:'',edits:[{path:target,before:protectedSource?'Original read only.':'Stop after error.',after:protectedSource?'Proposed reviewed original.':'Return to coordinator after error.'}]})}}));
`);chmodSync(fake,0o700);
 const server=spawn(process.execPath,[new URL('../backend/server.mjs',import.meta.url).pathname],{env:{...process.env,KEEPMIND_STATE_DIR:state,KEEPMIND_SHARED_VAULT:vault,KEEPMIND_MEMORY_DIR:join(state,'memory'),KEEPMIND_BRIDGE_PORT:String(port),KEEPMIND_CODEX_BIN:fake,KEEPMIND_BACKGROUND:'0'},stdio:'ignore'});
 const headers={'X-Keepmind-UI':'1'};const base='http://127.0.0.1:'+port+'/api/keepmind';
 const call=async(p,data)=>{const r=await fetch(base+p,{headers,method:data?'POST':'GET',...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json()}};
 try{
  let session;for(let i=0;i<100;i++){try{session=await call('/session');break}catch{await Bun.sleep(30)}}
  headers['X-Keepmind-Session']=session.data.token;
  const starts=await Promise.all([call('/proposal/execute',{id:'proposal'}),call('/proposal/execute',{id:'proposal'})]);
  expect(starts.some(r=>r.status===200)).toBe(true);
  let row;for(let i=0;i<150;i++){row=(await call('/proposal/executions')).data.find(r=>r.jobId==='proposal');if(row&&['done','failed','blocked','rolled_back'].includes(row.status))break;await Bun.sleep(30)}
  expect(row.status).toBe('done');expect(row.changes[0].after).toContain('Return to coordinator');
  expect(readFileSync(note,'utf8')).toBe('# Flow\nReturn to coordinator after error.');
  expect((await call('/proposal/execute',{id:'proposal'})).data.id).toBe(row.id);
  expect((await call('/proposal/decision',{id:'proposal',status:'open'})).status).toBe(400);
  expect((await call('/proposal/undo',{id:'proposal'})).data.status).toBe('undone');
  expect(readFileSync(note,'utf8')).toBe('# Flow\nStop after error.');
  expect((await call('/proposal/execute',{id:'protected'})).data.status).toBe('planning');
  let staged;for(let i=0;i<150;i++){staged=(await call('/proposal/executions')).data.find(r=>r.jobId==='protected');if(staged.status!=='planning')break;await Bun.sleep(30)}
  expect(staged.status).toBe('staged');expect(staged.changes[0].after).toBe('Proposed reviewed original.');
  expect((await call('/proposal/undo',{id:'protected'})).data.status).toBe('withdrawn');
  expect(readFileSync(original,'utf8')).toBe('Original read only.');
  expect(JSON.parse(readFileSync(join(state,'ui-bridge-jobs.json'),'utf8')).filter(j=>j.implementation).length).toBe(2);
 }finally{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));rmSync(dir,{recursive:true,force:true})}
},20000);
