import {createHash,randomUUID} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const required=(v,max=600)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Invalid usage field');return v.trim()};
const id=v=>{if(!/^[a-f0-9-]{36}$/.test(v))throw Error('Invalid receipt');return v};
// Immutable Markdown receipts in the existing vault, separate from original notes.
export class UsageLedger {
 constructor({read,append,list}){Object.assign(this,{read,append,list})}
 path(key,phase){return `long-term/usage/${id(key)}-${phase}.md`}
 load(key,phase){return JSON.parse(this.read(this.path(key,phase)).split('\n').slice(2).join('\n'))}
 save(row,phase){this.append(this.path(row.id,phase),'# KeepMind usage receipt\n\n'+JSON.stringify(row));return row}
 start(a,context){const agent=required(a.agent,80),task=required(a.task),model=required(a.model,120);if(!['github','keepmind'].includes(a.mode))throw Error('Invalid comparison mode');
 if(a.project!==undefined&&(typeof a.project!=='string'||a.project.length>300))throw Error('Invalid project');
 const sources=a.mode==='github'?[]:context.map(s=>({path:s.path,hash:sha(this.read(s.path))}));
 return this.save({id:randomUUID(),at:new Date().toISOString(),agent,model,task,project:a.project||null,mode:a.mode,comparisonKey:a.comparisonKey?required(a.comparisonKey,160):null,sources,kind:'agent-task'},'start')}
 finish(a){const start=this.load(a.id,'start');if(!['success','failure','unknown'].includes(a.outcome))throw Error('Invalid outcome');
 if(!Array.isArray(a.usedPaths)||a.usedPaths.some(p=>!start.sources.some(s=>s.path===p)))throw Error('Unissued context');
 const evidencePath=required(a.evidencePath,500),quote=required(a.quote,1600),body=this.read(evidencePath);if(!body.includes(quote))throw Error('Evidence quote absent');
 const metrics={};for(const k of ['corrections','durationMs','inputTokens','outputTokens']){if(a[k]!==undefined){if(!Number.isSafeInteger(a[k])||a[k]<0)throw Error('Invalid metric');metrics[k]=a[k]}}
 const used=[...new Set(a.usedPaths)].map(path=>{const original=start.sources.find(s=>s.path===path);return {path,hash:original.hash,unchanged:sha(this.read(path))===original.hash}});
 return this.save({...start,finishedAt:new Date().toISOString(),outcome:a.outcome,summary:required(a.summary),errorKey:a.errorKey?required(a.errorKey,120):null,used,evidence:{path:evidencePath,quote,hash:sha(body)},metrics,assessment:'agent-reported; source quote checked, outcome not independently verified'},'finish')}
 rows(){const out=[];for(const p of this.list().filter(p=>/^long-term\/usage\/[a-f0-9-]{36}-finish\.md$/.test(p))){try{const r=JSON.parse(this.read(p).split('\n').slice(2).join('\n'));if(r.kind==='agent-task')out.push({...r,receiptPath:p})}catch{}}return out.sort((a,b)=>a.at.localeCompare(b.at))}
}
export function valueReport(rows,now=Date.now()){
 const recent=rows.filter(r=>Date.parse(r.at)>=now-7*86400000&&Date.parse(r.at)<=now);
 const groups=new Map();for(const r of recent){if(!r.comparisonKey)continue;const key=JSON.stringify([r.agent,r.model,r.comparisonKey]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}
 const pairs=[];for(const group of groups.values()){const a=group.filter(r=>r.mode==='github'),b=group.filter(r=>r.mode==='keepmind');if(a.length!==1||b.length!==1)continue;const baseline=a[0],candidate=b[0];pairs.push({baselineId:baseline.id,candidateId:candidate.id,task:candidate.task,baseline:baseline.metrics,candidate:candidate.metrics,outcomes:[baseline.outcome,candidate.outcome],assessment:'reported comparison; not causal proof'})}
 const recurrent=new Map();for(const r of recent.filter(r=>r.outcome==='failure'&&r.errorKey)){const arr=recurrent.get(r.errorKey)||[];arr.push(r.id);recurrent.set(r.errorKey,arr)}
 return {windowDays:7,tasks:recent.length,agents:[...new Set(recent.map(r=>r.agent))],contextUsed:recent.filter(r=>r.used?.some(s=>s.unchanged)).length,comparisons:pairs,recurringErrors:[...recurrent].filter(([,ids])=>ids.length>=2).map(([key,ids])=>({key,ids})),verifiedGain:null,records:recent.map(r=>({id:r.id,agent:r.agent,task:r.task,outcome:r.outcome,path:r.receiptPath,assessment:r.assessment}))};
}
