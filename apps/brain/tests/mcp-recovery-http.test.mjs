import {test,expect} from 'bun:test';import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';
for(const fault of ['stall','exit','always-stall'])test(`Hoje reconnects after MCP ${fault}, serves fresh data and coalesces concurrent recovery`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'km-http-recovery-')),backend=join(dir,'backend'),vault=join(dir,'vault'),state=join(dir,'state'),starts=join(dir,'starts');mkdirSync(vault);mkdirSync(state);writeFileSync(join(vault,'real.md'),'# Actual MCP fixture memory');cpSync(new URL('../backend/',import.meta.url).pathname,backend,{recursive:true});
 const clientFile=join(backend,'mcp-client.mjs');writeFileSync(clientFile,readFileSync(clientFile,'utf8').replaceAll('60000','400'));
 cpSync(join(backend,'shared-mcp.mjs'),join(backend,'real-shared-mcp.mjs'));
 writeFileSync(join(backend,'shared-mcp.mjs'),`import {existsSync,writeFileSync,appendFileSync} from 'node:fs';import {createInterface} from 'node:readline';
 appendFileSync(process.env.TEST_STARTS,process.pid+'\\n');
 if(existsSync(process.env.TEST_ONCE)&&process.env.TEST_FAULT!=='always-stall'){await import('./real-shared-mcp.mjs')}else{
 writeFileSync(process.env.TEST_ONCE,'started');
 for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.id===undefined)continue;
 if(m.params?.name==='sb_list'){if(process.env.TEST_FAULT==='exit')process.exit(7);await new Promise(()=>{});}
 const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fault-before-real-mcp',version:'1'}}:{content:[{type:'text',text:m.params?.name==='km_status'?JSON.stringify({configured:true,unlocked:true}):'[]'}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');}
 }`);
 const port=fault==='stall'?24183:fault==='exit'?24184:24185,proc=spawn(process.execPath,[join(backend,'server.mjs')],{env:{...process.env,KEEPMIND_STATE_DIR:state,KEEPMIND_SHARED_VAULT:vault,KEEPMIND_MEMORY_DIR:join(state,'memory'),KEEPMIND_BRIDGE_PORT:String(port),KEEPMIND_BACKGROUND:'0',KEEPMIND_MCP_TIMEOUT_MS:'400',TEST_STARTS:starts,TEST_ONCE:join(dir,'once'),TEST_FAULT:fault},stdio:['ignore','ignore','pipe']});let logs='';proc.stderr.on('data',b=>logs+=b);
 const headers={'X-Keepmind-UI':'1'},base=`http://127.0.0.1:${port}/api/keepmind`;const get=async p=>{const r=await fetch(base+p,{headers,signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()}};
 try{let session;for(let i=0;i<100;i++){try{session=await get('/session');break}catch{await Bun.sleep(20)}}expect(session?.body.token).toBeTruthy();headers['X-Keepmind-Session']=session.body.token;
 const results=await Promise.all(['/today','/notes','/skills','/learnings'].map(get));
 console.info(JSON.stringify({fault,results:results.map(r=>({status:r.status,error:r.body.error})),processes:readFileSync(starts,'utf8').trim().split('\n').length}));
 if(fault==='always-stall'){expect(results[0].status).toBe(400);expect(results[0].body.error).toBeTruthy();expect(results[0].body.available).not.toBe(true);expect(readFileSync(starts,'utf8').trim().split('\n').length).toBeLessThanOrEqual(2);return;}
 expect(results[0].status).toBe(200);expect(results[0].body.available).toBe(true);expect(results.every(r=>r.status===200)).toBe(true);expect(results[1].body.some(n=>n.path==='real.md')).toBe(true);
 expect(readFileSync(starts,'utf8').trim().split('\n')).toHaveLength(2);expect((await get('/today')).body.available).toBe(true);expect(readFileSync(join(vault,'real.md'),'utf8')).toBe('# Actual MCP fixture memory');expect(existsSync(join(state,'ui-autonomy.json'))).toBe(false);
 }finally{proc.kill('SIGTERM');await new Promise(r=>proc.once('exit',r));rmSync(dir,{recursive:true,force:true})}
},15000);
