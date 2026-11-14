import {correctionDraft,applicableCorrections} from './corrections.mjs';
import {contextPack,contextDrift,contextIntent} from './context-pack.mjs';
import {retrieve} from './retrieval.mjs';
import {UsageLedger,valueReport} from './usage-ledger.mjs';
// Adapter for an existing Markdown vault. No encryption migration or GitHub operations.
import {readFileSync,writeFileSync,renameSync,mkdirSync,readdirSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {join,resolve,sep,dirname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
const root=realpathSync(process.env.KEEPMIND_SHARED_VAULT);
const allowedPaths=process.env.KEEPMIND_ALLOWED_PATHS?JSON.parse(process.env.KEEPMIND_ALLOWED_PATHS):null;
const owner=process.env.KEEPMIND_SHARED_OWNER==='1';
const output='KeepMind-Bridge';
const hash=s=>createHash('sha256').update(s).digest('hex');
const forbidden=p=>p.split('/').some(x=>x.startsWith('.')||/secret|credential|quarantine/i.test(x));
function safe(p){if(typeof p!=='string'||!p.endsWith('.md')||p.split('/').some(x=>!x||x==='..'||x==='.')||forbidden(p)||p.includes('\\'))throw Error('Path denied');const f=resolve(root,p);if(!f.startsWith(root+sep))throw Error('Path denied');let check=f;while(check!==root){if(existsSync(check)&&lstatSync(check).isSymbolicLink())throw Error('Symlink denied');check=dirname(check)}let a=f;while(!existsSync(a))a=dirname(a);if(!realpathSync(a).startsWith(root+sep)&&realpathSync(a)!==root)throw Error('Symlink denied');if(existsSync(f)&&lstatSync(f).isSymbolicLink())throw Error('Symlink denied');return f}
function physical(p){return /^(notes|skills|long-term|learnings)\//.test(p)&&existsSync(safe(output+'/'+p))?output+'/'+p:p}
function permitted(s){return !s.startsWith('KEEPMIND-')&&!/^(?:class|classification|confidentiality):\s*["']?(?:secret|sensitive|restricted|confidential)/mi.test(s)&&!/\b(?:gh[o,p,s,u,r]_[A-Za-z0-9]{12,}|github_pat_[\w]+|sk-[\w-]{16,}|xox[baprs]-[\w-]+)|-----BEGIN .*PRIVATE KEY-----/.test(s)}
function read(p){if(allowedPaths&&!allowedPaths.includes(p))throw Error('Source not authorized');const s=readFileSync(safe(physical(p)),'utf8');if(!permitted(s))throw Error('Content outside shared scope');return s}
let fileCache=null,cacheAt=0;
function files(dir=root,prefix=''){if(dir===root&&fileCache&&Date.now()-cacheAt<15000)return fileCache;let a=[];for(const e of readdirSync(dir,{withFileTypes:true})){const p=prefix+e.name;if(forbidden(p)||e.isSymbolicLink())continue;if(e.isDirectory())a.push(...files(join(dir,e.name),p+'/'));else if(e.isFile()&&p.endsWith('.md')){try{const text=readFileSync(safe(p),'utf8');if(permitted(text))a.push(p.startsWith(output+'/')?p.slice(output.length+1):p)}catch{}}}if(dir===root){fileCache=a;cacheAt=Date.now()}return a}
function write(p,body){fileCache=null;if(!owner)throw Error('Read-only agent');if(p.startsWith('long-term/usage/'))throw Error('Usage receipts are immutable');if(!/^(notes|skills|long-term|learnings)\//.test(p)||typeof body!=='string'||body.length>120000||!permitted(body))throw Error('Write denied');if(existsSync(safe(p))&&!existsSync(safe(output+'/'+p)))throw Error('Existing source is read-only');const f=safe(output+'/'+p);mkdirSync(dirname(f),{recursive:true});const tmp=f+'.'+randomUUID()+'.tmp';writeFileSync(tmp,body,{mode:0o600,flag:'wx'});renameSync(tmp,f);return p}
const learningPath=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid learning');return 'learnings/'+id+'.md'};
function load(id){const body=readFileSync(safe(output+'/'+learningPath(id)),'utf8');const marker='\n<!-- keepmind-learning:';const start=body.lastIndexOf(marker);if(start<0||!body.endsWith(' -->\n'))throw Error('Invalid learning record');return JSON.parse(body.slice(start+marker.length,-5))}
function save(row){write(learningPath(row.id),'# Proposta de aprendizado operacional\n\n'+row.body+'\n\nEstado: '+row.status+'\nFonte: '+row.sourcePath+'\n\n<!-- keepmind-learning:'+JSON.stringify(row)+' -->\n');return row}
function learners(){const d=join(root,output,'learnings');if(!existsSync(d))return [];return readdirSync(d).filter(x=>/^[a-f0-9-]{36}\.md$/.test(x)).map(x=>load(x.slice(0,-3))).map(l=>{try{if(hash(read(l.sourcePath))!==l.sourceHash)return {...l,status:'suspended'}}catch{return {...l,status:'suspended'}}return l})}
let graphCache=null,graphAt=0;
function graph(){
 if(graphCache&&Date.now()-graphAt<60000)return graphCache;
 const paths=activeFiles(), nodes=new Map(paths.map(p=>[p.replace(/\.md$/,''),{id:p.replace(/\.md$/,''),label:p.split('/').pop().replace(/\.md$/,''),dir:p.split('/')[0],links:0}]));
 const basenames=new Map();for(const n of nodes.values()){const key=n.label.toLowerCase();basenames.set(key,basenames.has(key)?null:n.id)}
 const edges=new Map();
 for(const p of paths){let content;try{content=read(p)}catch{continue}const source=p.replace(/\.md$/,'');for(const m of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|\]\(([^)\s]+?\.md)(?:#[^)\s]*)?[^)]*\)/g)){
 let target=m[1]||m[2];try{target=decodeURIComponent(target)}catch{}target=target.replace(/\.md$/,'').replace(/^\.\//,'');
 const relative=join(dirname(source),target);const id=nodes.has(target)?target:nodes.has(relative)?relative:basenames.get(target.split('/').pop().toLowerCase());
 if(id&&id!==source){const key=JSON.stringify([source,id]);if(!edges.has(key)){edges.set(key,[source,id]);nodes.get(source).links++;nodes.get(id).links++}}
 }}
 const selected=[...nodes.values()].sort((a,b)=>b.links-a.links).slice(0,800);const keep=new Set(selected.map(n=>n.id));graphCache={nodes:selected,links:[...edges.values()].filter(([a,b])=>keep.has(a)&&keep.has(b)),totalFiles:paths.length};graphAt=Date.now();return graphCache;
}
const archivePath='long-term/maintenance-index.md';
function archiveRows(){const f=safe(output+'/'+archivePath);if(!existsSync(f))return [];const body=readFileSync(f,'utf8');return JSON.parse(body.slice(body.indexOf('\n')+1))}
function activeFiles(){const rows=archiveRows();return files().filter(p=>!rows.some(r=>r.path===p&&r.status==='archived'&&hash(read(p))===r.hash))}
function archiveNote(a){
 if(!/^long-term\/maintenance\//.test(a.path)||!existsSync(safe(output+'/'+a.path)))throw Error('Only generated maintenance reports may be archived');
 if(a.path===a.canonical||hash(read(a.path))!==a.hash||hash(read(a.canonical))!==a.hash)throw Error('Exact duplicate evidence required');
 const rows=archiveRows();if(rows.some(r=>r.path===a.path&&r.hash===a.hash&&r.status==='restored'))return JSON.stringify(rows);if(!rows.some(r=>r.path===a.path&&r.hash===a.hash&&r.status==='archived'))rows.push({id:randomUUID(),path:a.path,hash:a.hash,canonical:a.canonical,status:'archived',at:new Date().toISOString()});
 write(archivePath,'# Reversible cleanup index\n'+JSON.stringify(rows));graphCache=null;return JSON.stringify(rows);
}
function restoreArchive(a){const rows=archiveRows(),row=rows.find(r=>r.id===a.id);if(!row)throw Error('Archive missing');row.status='restored';row.restoredAt=new Date().toISOString();write(archivePath,'# Reversible cleanup index\n'+JSON.stringify(rows));graphCache=null;return JSON.stringify(row)}
function appendUsage(p,body){
 if(!/^long-term\/usage\/[a-f0-9-]{36}-(start|finish)\.md$/.test(p)||!permitted(body))throw Error('Usage denied');
 const f=safe(output+'/'+p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,body,{mode:0o600,flag:'wx'});fileCache=null;
}
const ledger=new UsageLedger({read:p=>read(p),append:appendUsage,list:()=>files()});
const usageEnabled=!allowedPaths&&(owner||process.env.KEEPMIND_USAGE==='1');
function contextFor(task,options={}){
 const purpose=contextIntent(task,options.intent);
 const available=allowedPaths||activeFiles();
 const rootAlias=options.project===basename(root)&&!available.some(p=>p.startsWith(options.project+'/'));
 if(rootAlias)options={...options,project:undefined};
 const permittedPaths=available.filter(p=>!/^long-term\/usage\//.test(p)&&(purpose!=='task'||!/^long-term\/maintenance/.test(p))&&!/^skills\/history\//.test(p)&&!/^notes\/change-proposals\//.test(p));
 const learningRows=learners();
 const active=new Set(learningRows.filter(l=>l.status==='active'&&l.kind!=='correction').map(l=>learningPath(l.id)));
 const corrections=applicableCorrections(learningRows,task,purpose,read,{allowedPaths,project:options.project});
 const pack=contextPack(task,permittedPaths.filter(p=>!p.startsWith('learnings/')||active.has(p)),read,{...options,corrections,intent:purpose,usage:allowedPaths?[]:ledger.rows()});
 return {...pack,root:{name:basename(root),pathsRelativeToRoot:true,rootAliasNormalized:rootAlias},...(!pack.sources.length?{availableProjectPrefixes:[...new Set(permittedPaths.map(p=>p.split('/')[0]))].slice(0,30)}:{})};
}
const readTools=['sb_list','sb_read','sb_search','sb_context','sb_task_context'];
const usageTools=usageEnabled?['sb_task_start','sb_task_finish']:[];

const ownerTools=['km_usage','km_value','km_archive','km_archive_list','km_archive_restore','km_graph','km_status','km_learning_list','km_correction_propose','km_learning_propose','km_learning_approve','km_learning_source','km_learning_suspend','sb_write'];
function call(name,a={}){
 if(!owner&&!readTools.includes(name)&&!usageTools.includes(name))throw Error('Read-only agent');
 switch(name){
 case 'km_archive':return archiveNote(a);
 case 'km_archive_list':return JSON.stringify(archiveRows());
 case 'km_archive_restore':return restoreArchive(a);
 case 'km_graph':return JSON.stringify(graph());
 case 'km_status':return JSON.stringify({configured:true,unlocked:true,encrypted:false,mode:'shared-markdown',transport:'stdio',spaces:['existing-vault'],version:'shared-1',memoryRoot:root});
 case 'sb_list':return (allowedPaths?allowedPaths.filter(p=>{try{read(p);return true}catch{return false}}):activeFiles()).join('\n');
 case 'sb_read':return read(a.path);
 case 'sb_search':return retrieve(a.query,allowedPaths||activeFiles(),read,{limit:10}).map(r=>r.path).join('\n');
 case 'sb_context':return JSON.stringify(contextFor(a.query,{project:a.project,budget:a.budget,intent:a.intent}));
 case 'sb_task_context':{const r=ledger.load(a.id,'start');const versions=contextDrift(r.sources,read);return JSON.stringify({id:r.id,task:r.task,project:r.project||null,versions,needsRefresh:versions.some(s=>s.status!=='current'),instruction:'If changed, reread affected sources before acting; do not reuse obsolete context.'})}
 case 'sb_task_start':{if(!usageEnabled)throw Error('Usage disabled');const pack=a.mode==='github'?{sources:[]}:contextFor(a.task,{project:a.project,budget:a.budget,intent:a.intent});const correctionSources=(pack.corrections||[]).flatMap(c=>[{path:c.path,hash:hash(read(c.path))},{path:c.evidence.path,hash:c.evidence.hash}]);const receipt=ledger.start(a,[...new Map([...pack.sources,...correctionSources].map(s=>[s.path,s])).values()]);return JSON.stringify({receipt,...pack})}
 case 'sb_task_finish':{if(!usageEnabled)throw Error('Usage disabled');return JSON.stringify(ledger.finish(a))}
 case 'km_usage':return JSON.stringify(ledger.rows());
 case 'km_value':return JSON.stringify(valueReport(ledger.rows()));
 case 'sb_write':return write(a.path,a.content);
 case 'km_correction_propose':{const row={id:randomUUID(),...correctionDraft(a,read),status:'pending',createdAt:new Date().toISOString()};row.approvalDigest=hash(JSON.stringify(row));return JSON.stringify(save(row))}
 case 'km_learning_list':return JSON.stringify(learners());
 case 'km_learning_propose':{const src=read(a.path);if(!a.body?.trim()||!a.purpose?.trim())throw Error('Draft required');const row={id:randomUUID(),body:a.body,purpose:a.purpose,applicability:a.applicability,status:'pending',sourcePath:a.path,sourceHash:hash(src),createdAt:new Date().toISOString()};row.approvalDigest=hash(JSON.stringify(row));return JSON.stringify(save(row))}
 case 'km_learning_approve':{const l=load(a.id);const {approvalDigest,...reviewed}=l;if(hash(JSON.stringify(reviewed))!==approvalDigest)throw Error('Learning revision changed');if(a.approved!==true||l.status!=='pending'||a.approvalDigest!==l.approvalDigest||hash(read(l.sourcePath))!==l.sourceHash)throw Error('Exact current revision required');l.status='active';l.approvedAt=new Date().toISOString();return JSON.stringify(save(l))}
 case 'km_learning_source':{const l=load(a.id);return JSON.stringify({path:l.sourcePath,body:read(l.sourcePath),sourceChanged:hash(read(l.sourcePath))!==l.sourceHash})}
 case 'km_learning_suspend':{const l=load(a.id);l.status='suspended';return JSON.stringify(save(l))}
 default:throw Error('Unknown tool')
 }
}
for await(const line of createInterface({input:process.stdin})){let m;try{m=JSON.parse(line);if(m.id===undefined)continue;let result;if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'keepmind-shared-markdown',version:'2'},instructions:usageEnabled?'For real tasks involving this second brain, call sb_task_start with the actual agent and model, use relevant returned context, check sb_task_context before acting on earlier context, then sb_task_finish with a literal result evidence quote and only the context paths actually used. Never fabricate results or report tests as real tasks. Use mode github only for an explicitly matched baseline; otherwise keepmind. Original source writes remain unavailable.':'Use sb_context to retrieve task-relevant sources within your permissions.'};else if(m.method==='tools/list')result={tools:[...readTools,...usageTools,...(owner?ownerTools:[])].map(name=>({name,description:name==='sb_task_start'?'Before a real task: retrieve project-scoped relevant context and issue a usage receipt. Report agent/model accurately. For a matched GitHub baseline use mode github (no context).':name==='sb_task_finish'?'After a real task: report outcome, actually used context paths, corrections and evidence quote from a permitted file. Outcome remains agent-reported. Do not record synthetic tests as real use.':name==='sb_context'?'FIRST CALL for memory questions: returns literal citable content, complete short documents and evidence reports for handoff/audit tasks. No need to list the vault or reread complete=true documents. Follow gaps only when necessary. Paths are relative to the vault root (notes/, skills/, 00-Hermes/), not to the working directory. Omit project for cross-project tasks; project must be an existing folder prefix. Root name: '+basename(root)+'. budget is characters; intent is optional.':'KeepMind existing Markdown vault: '+name,annotations:{readOnlyHint:readTools.includes(name),destructiveHint:false,openWorldHint:false},inputSchema:{type:'object',properties:{body:{type:'string'},purpose:{type:'string'},applicability:{type:'string'},before:{type:'string'},after:{type:'string'},matchTerms:{type:'array',items:{type:'string'}},approved:{type:'boolean'},approvalDigest:{type:'string'},intent:{type:'string',enum:['task','handoff','audit'],description:'Optional; inferred from the task when omitted. Handoff/audit include evaluation reports as evidence, never as procedures.'},project:{type:'string',description:'Optional exact vault folder prefix; never broadens allowed paths'},budget:{type:'integer',minimum:500,maximum:24000},agent:{type:'string'},task:{type:'string'},model:{type:'string'},mode:{type:'string',enum:['github','keepmind']},comparisonKey:{type:'string'},outcome:{type:'string',enum:['success','failure','unknown']},summary:{type:'string'},evidencePath:{type:'string'},quote:{type:'string'},errorKey:{type:'string'},usedPaths:{type:'array',items:{type:'string'}},corrections:{type:'integer',minimum:0},durationMs:{type:'integer',minimum:0},inputTokens:{type:'integer',minimum:0},outputTokens:{type:'integer',minimum:0},path:{type:'string'},query:{type:'string'},id:{type:'string'},hash:{type:'string'},canonical:{type:'string'},content:{type:'string'}},...({sb_read:['path'],sb_search:['query'],sb_context:['query'],sb_task_context:['id'],sb_task_start:['agent','model','task','mode'],sb_task_finish:['id','outcome','summary','evidencePath','quote','usedPaths']}[name]?{required:{sb_read:['path'],sb_search:['query'],sb_context:['query'],sb_task_context:['id'],sb_task_start:['agent','model','task','mode'],sb_task_finish:['id','outcome','summary','evidencePath','quote','usedPaths']}[name]}:{})}}))};else if(m.method==='tools/call')result={content:[{type:'text',text:call(m.params.name,m.params.arguments)}]};else throw Error('Method unavailable');process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n')}catch(e){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m?.id??null,result:{isError:true,content:[{type:'text',text:e.message}]}})+'\n')}}
