import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {sameProposal} from './proposals.mjs';
export class ProposalDecisions {
 constructor(file){this.file=file;this.rows=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];if(!Array.isArray(this.rows))throw Error('Invalid proposal decision ledger');}
 find(result){return this.rows.find(r=>sameProposal(r.result,result));}
 set(job,status){
  if(!['accepted','resolved','dismissed','open'].includes(status)||job?.status!=='done'||!job.result?.skill||!job.result?.learning)throw Error('Proposta ou decisão inválida');
  const prior=this.find(job.result);
  const row={jobId:job.id,status,at:new Date().toISOString(),result:job.result};
  const next=this.rows.filter(r=>!sameProposal(r.result,job.result));
  if(status!=='open')next.push(row);
  mkdirSync(dirname(this.file),{recursive:true});
  writeFileSync(this.file+'.tmp',JSON.stringify(next),{mode:0o600});renameSync(this.file+'.tmp',this.file);this.rows=next;
  return {status,at:row.at,previous:prior?.status||'open'};
 }
}
