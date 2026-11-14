import {usageEvidence} from './real-usage.mjs';
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectMemory,sha} from './maintenance.mjs';
import {eligibleSkill,evaluationGoal,grade,promotionEvidence} from './skill-evolution.mjs';
const DAY=86400000;
export class Cycles {
 constructor(file,io){this.file=file;this.io=io;this.busy=false;this.state={lastMaintenance:0,lastEvolution:0,trials:[]};if(existsSync(file))this.state=JSON.parse(readFileSync(file,'utf8'))}
 save(){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.state),{mode:0o600});renameSync(this.file+'.tmp',this.file)}
 async observedForSkill(path,baselineHash){
  const rows=usageEvidence(await this.io.jobs?.()||[],await this.io.decisions?.()||[],Date.now(),30*DAY).filter(j=>j.skillPath===path||j.usedSkillPaths?.includes(path));
  const valid=[];for(const row of rows){
   if(row.external){
    if(!row.skillRevisions?.some(s=>s.path===path&&s.hash===baselineHash&&s.unchanged)||!row.evidence?.path)continue;
    try{if(sha(await this.io.read(row.evidence.path))!==row.evidence.hash)continue}catch{continue}
   }
   if(!row.external&&(row.skillHash!==baselineHash||!row.reads?.includes(path)))continue;
   valid.push(row);
  }return valid;
 }
 async enqueue(path,baseline,candidate,metadata){
  if(this.state.trials.some(t=>t.path===path&&['queued','testing','promoting'].includes(t.status)))throw Error('Já existe uma evolução em teste');
  const observed=await this.observedForSkill(path,sha(baseline));
  const id=randomUUID(),snapshot='skills/history/'+id+'-candidate.md',base='skills/history/'+id+'-baseline.md';
  await this.io.write(base,baseline);await this.io.write(snapshot,candidate);
  const trial={id,name:metadata.name,path,base,snapshot,baselineHash:sha(baseline),candidateHash:sha(candidate),learningId:metadata.learningId,suite:'documentary-grounding-v1',usageEvidence:observed,status:!observed.length?'needs-usage-evidence':eligibleSkill(metadata)?'queued':'needs-suite',createdAt:new Date().toISOString(),runs:{}};
  this.state.trials.push(trial);this.save();return trial;
 }
 async maintenance(now=Date.now()){
  if(this.busy||now-this.state.lastMaintenance<DAY)return;
  this.busy=true;
  try{
   const result=await inspectMemory({...this.io,now});
   await this.io.write('long-term/maintenance/'+new Date(now).toISOString().slice(0,10)+'.md','# Ciclo de manutenção\n\n'+JSON.stringify(result,null,2));
   this.state.maintenance=result;this.state.lastMaintenance=now;delete this.state.error;this.save();
  }catch(e){this.state.error=e.message;this.save()}finally{this.busy=false}
 }
 async reconcile(jobs){
  // Resume stalled trials when real use arrives; still require unchanged versions and behavioral tests.
  for(const t of this.state.trials.filter(t=>t.status==='needs-usage-evidence')){
   try{
    if(sha(await this.io.read(t.path))!==t.baselineHash||sha(await this.io.read(t.snapshot))!==t.candidateHash){t.status='stale';continue}
    if(!(await this.io.learnings()).some(l=>l.id===t.learningId&&l.status==='active'))continue;
    const observed=await this.observedForSkill(t.path,t.baselineHash);
    if(observed.length){t.usageEvidence=observed;t.status=eligibleSkill({name:t.name})?'queued':'needs-suite';delete t.error;}
   }catch(e){t.error='Não foi possível conferir as fontes da evolução';}
  }

  for(const t of this.state.trials)if(['queued','testing','promoting'].includes(t.status)&&!t.usageEvidence?.length){t.status='needs-usage-evidence';t.error='Evolução suspensa: faltam registros de uso real vinculados à proposta';}

  // Recover launch -> ledger interruption using persisted, server-created correlation.
  for(const t of this.state.trials){for(const phase of ['baseline','candidate']){const j=jobs.find(j=>j.evaluation?.trialId===t.id&&j.evaluation.phase===phase);if(j&&!t.runs[phase]){t.runs[phase]={jobId:j.id};t.status='testing'}}}
  for(const t of this.state.trials.filter(t=>['testing','promoting'].includes(t.status))){
   for(const phase of ['baseline','candidate']){
    const id=t.runs[phase]?.jobId,j=jobs.find(j=>j.id===id);
    if(id&&!j){t.status='failed';t.error='Missing execution evidence';continue}
    if(j&&['failed','cancelled'].includes(j.status)){t.status='failed';t.error=j.error||j.status;continue}
    if(j?.status==='done'&&!t.runs[phase].evidence){try{t.runs[phase].evidence={...grade(j.result.answers),model:j.model,jobId:j.id,finishedAt:j.finishedAt};}catch(e){t.status='failed';t.error=e.message}}
   }
   if(t.status==='failed'){this.save();continue}
   if(t.runs.candidate?.evidence){
    if(!promotionEvidence(t.runs.baseline?.evidence,t.runs.candidate.evidence)){t.status='rejected';t.error='No strict improvement without regressions';this.save();continue}
    const current=await this.io.read(t.path),candidate=await this.io.read(t.snapshot);
    const active=(await this.io.learnings()).some(l=>l.id===t.learningId&&l.status==='active');
    if(sha(candidate)!==t.candidateHash||sha(await this.io.read(t.base))!==t.baselineHash||!active){t.status='stale';this.save();continue}
    // Recover a crash after atomic promotion, before recording its receipt.
    if(t.status==='promoting'&&sha(current)===t.candidateHash){t.status='promoted';this.save();continue}
    if(sha(current)!==t.baselineHash){t.status='stale';this.save();continue}
    t.status='promoting';this.save();
    await this.io.promote(t.path,candidate,t.baselineHash);
    t.status='promoted';t.promotedAt=new Date().toISOString();this.save();

   }
  }
  for(const t of this.state.trials.filter(t=>['promoted','rejected','failed','stale','rolled-back'].includes(t.status))){
   if(t.reportedStatus===t.status)continue;
   await this.io.write('long-term/maintenance/skill-'+t.id+'.md','# Evidência de evolução\n\n'+JSON.stringify(t,null,2));t.reportedStatus=t.status;
  }
  this.save();
 }
 async nextEvaluation(now=Date.now()){
  const t=this.state.trials.find(t=>['queued','testing'].includes(t.status));if(!t)return null;
  const phase=!t.runs.baseline?'baseline':t.runs.baseline.evidence&&!t.runs.candidate?'candidate':null;if(!phase)return null;
  const path=phase==='baseline'?t.base:t.snapshot;
  if(sha(await this.io.read(t.path))!==t.baselineHash||sha(await this.io.read(path))!==(phase==='baseline'?t.baselineHash:t.candidateHash)||!(await this.io.learnings()).some(l=>l.id===t.learningId&&l.status==='active')){t.status='stale';this.save();return null}
  return {trial:t,phase,path,goal:evaluationGoal()};
 }
 recordRun(task,job){task.trial.status='testing';task.trial.runs[task.phase]={jobId:job.id};this.save()}
 async proposeWeekly(){
  // Candidates must come from observed usage and an explicit reviewed proposal.
  // The weekly retrospective replaces the former generic rule-based mutation.
 }
 async rollback(id){const t=this.state.trials.find(t=>t.id===id&&t.status==='promoted');if(!t)throw Error('Promoted trial required');const old=await this.io.read(t.base);if(sha(old)!==t.baselineHash)throw Error('Baseline changed');await this.io.promote(t.path,old,t.candidateHash);t.status='rolled-back';this.save();return t}
}
