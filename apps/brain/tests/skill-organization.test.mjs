import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
test('organization persists against isolated shared memory without changing skill or accepting non-skill paths',()=>{
 const root=mkdtempSync(join(tmpdir(),'km-skill-org-')),vault=join(root,'vault'),state=join(root,'state');
 mkdirSync(join(vault,'skills'),{recursive:true});mkdirSync(state);
 writeFileSync(join(vault,'skills/example.md'),'# Fixture skill\nTest data only.');
 writeFileSync(join(vault,'note.md'),'# Not a skill');
 const code=`
 const {handle,shutdown}=await import(${JSON.stringify(new URL('../backend/server.mjs',import.meta.url).href)});
 const h={'X-Keepmind-UI':'1'};
 async function call(path,data){const r=await handle(new Request('http://127.0.0.1:4175/api/keepmind'+path,{method:data?'POST':'GET',headers:h,...(data?{body:JSON.stringify(data)}:{})}));return [r.status,await r.json()]}
 try{
 h['X-Keepmind-Session']=(await call('/session'))[1].token;
 const saved=await call('/skills/organization',{path:'skills/example.md',category:'Pesquisa',tags:['teste']});
 if(saved[0]!==200)throw Error(JSON.stringify(saved));
 const loaded=await call('/skills/organization');
 if(loaded[1]['skills/example.md'].tags[0]!=='teste')throw Error('not persisted');
 if((await call('/skills/organization',{path:'note.md',category:'Bad',tags:[]}))[0]!==400)throw Error('non-skill accepted');
 if((await call('/skills/review',{path:'skills/example.md',consent:false}))[0]!==400)throw Error('consent missing');
 console.log('ok');
 }finally{shutdown()}
 `;
 try{
 const out=spawnSync(process.execPath,['--eval',code],{env:{...process.env,KEEPMIND_SHARED_VAULT:vault,KEEPMIND_STATE_DIR:state,KEEPMIND_MEMORY_DIR:join(state,'memory'),KEEPMIND_BACKGROUND:'0'},encoding:'utf8',timeout:15000});
 expect(out.status).toBe(0);expect(out.stdout).toContain('ok');
 expect(readFileSync(join(vault,'skills/example.md'),'utf8')).toBe('# Fixture skill\nTest data only.');
 expect(JSON.parse(readFileSync(join(state,'skill-organization.json'),'utf8'))['skills/example.md'].category).toBe('Pesquisa');
 }finally{rmSync(root,{recursive:true,force:true})}
},20000);
