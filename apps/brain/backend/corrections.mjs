import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const escapeRegExp=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const BOUNDARY='(?<![\\p{L}\\p{N}_])';
const TERM_PATTERN=t=>new RegExp(BOUNDARY+escapeRegExp(t)+'(?![\\p{L}\\p{N}_])','u');
export function correctionDraft(a,read){
 for(const key of ['agent','model','before','after','quote','purpose'])if(typeof a[key]!=='string'||!a[key].trim()||a[key].length>1600)throw Error('Correction requires bounded '+key);
 if(!Array.isArray(a.matchTerms)||!a.matchTerms.length||a.matchTerms.length>8||a.matchTerms.some(t=>typeof t!=='string'||t.trim().length<3||t.length>80))throw Error('Explicit match terms required');
 if(!['task','handoff','audit'].includes(a.intent))throw Error('Explicit correction intent required');
 const src=read(a.path);if(!src.includes(a.quote))throw Error('Correction evidence quote missing');
 return {kind:'correction',version:1,agent:a.agent,model:a.model,before:a.before,after:a.after,quote:a.quote,purpose:a.purpose,body:a.after,applicability:{intent:a.intent,matchTerms:a.matchTerms.map(normalize)},sourcePath:a.path,sourceHash:hash(src),assessment:'Owner-reviewed operational correction; effectiveness requires recipient evidence'};
}
export function applicableCorrections(rows,task,intent,read,{allowedPaths,project}={}){
 const normalizedTask=normalize(task);
 return rows.filter(r=>r.kind==='correction'&&r.status==='active').filter(r=>{
  const path='learnings/'+r.id+'.md';
  if(allowedPaths&&(!allowedPaths.includes(path)||!allowedPaths.includes(r.sourcePath)))return false;
  if(project&&r.sourcePath!==project&&!r.sourcePath.startsWith(project+'/'))return false;
  if(r.applicability?.intent!==intent||!r.applicability.matchTerms.every(t=>TERM_PATTERN(t).test(normalizedTask)))return false;
  try{return hash(read(r.sourcePath))===r.sourceHash&&read(r.sourcePath).includes(r.quote)}catch{return false}
 }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,2).map(r=>({path:'learnings/'+r.id+'.md',id:r.id,version:r.version,author:{agent:r.agent,model:r.model},before:r.before,apply:r.after,evidence:{path:r.sourcePath,hash:r.sourceHash,quote:r.quote},assessment:r.assessment}));
}
