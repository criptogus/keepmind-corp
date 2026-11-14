import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const hash=s=>createHash('sha256').update(s).digest('hex');
export const writableProposalPath=p=>typeof p==='string'&&/^(notes|long-term)\/.+\.md$/.test(p)&&!p.split('/').some(s=>!s||s==='.'||s==='..'||s.startsWith('.'))&&!p.includes('\\')&&!/^long-term\/(facts\.md|maintenance\/|usage\/)/.test(p);
export class ProposalExecutions{
 constructor(file,io){this.file=file;this.io=io;this.rows=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];this.locks=new Set()}
 save(){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.rows),{mode:0o600});renameSync(this.file+'.tmp',this.file)}
 find(jobId){return [...this.rows].reverse().find(x=>x.jobId===jobId)}
 view(row){if(!row)return null;const {sources,...v}=row;return {...v,changes:row.changes?.map(({path,before,after,applied,restored})=>({path,before,after,applied,restored}))||[]}}
 async prepare(job){
  if(this.locks.has(job.id))throw Error('Proposta já está sendo preparada');
  this.locks.add(job.id);
  try{
   const prior=this.find(job.id);if(prior&&!['undone','failed','rolled_back','blocked'].includes(prior.status))return prior;
   if(job.status!=='done'||!job.result?.summary||!job.result?.sourcePaths?.length)throw Error('Proposta sem fontes verificáveis');
   const sources=[];
   for(const path of [...new Set(job.result.sourcePaths)])sources.push(await this.io.read(path));
   const row={id:randomUUID(),jobId:job.id,at:new Date().toISOString(),status:'planning',sources,changes:[],message:'Preparando alteração nas fontes autorizadas.'};
   if(!sources.some(s=>!s.readOnly&&writableProposalPath(s.path))){row.status=this.io.stage?'planning':'blocked';row.stageOnly=!!this.io.stage;row.message='As fontes desta proposta são somente leitura ou exigem um fluxo especializado. Nenhum arquivo foi alterado.'}
   this.rows.push(row);this.save();return row;
  }finally{this.locks.delete(job.id)}
 }
 async apply(id,plan,reads){
  const row=this.rows.find(r=>r.id===id);
  if(!row||row.status!=='planning')throw Error('Execução não está aguardando plano');
  if(plan.blockedReason){row.status='blocked';row.message=plan.blockedReason;this.save();return row}
  try{
   if(!plan.summary?.trim()||!Array.isArray(plan.edits)||!plan.edits.length||plan.edits.length>4)throw Error('Plano sem alteração verificável');
   const paths=new Set();
   for(const e of plan.edits){
    const source=row.sources.find(s=>s.path===e.path);
    if(!source||(!row.stageOnly&&(source.readOnly||!writableProposalPath(e.path)))||!reads.includes(e.path)||paths.has(e.path))throw Error('Plano ultrapassa as fontes graváveis autorizadas');
    paths.add(e.path);
    if(typeof e.before!=='string'||!e.before.trim()||typeof e.after!=='string'||!e.after.trim()||e.after===e.before||e.after.length>120000)throw Error('Alteração inválida');
    if(source.body.split(e.before).length!==2)throw Error('Trecho anterior não é único na fonte');
    const after=source.body.replace(e.before,()=>e.after);
    if(after.length>120000)throw Error('Documento excede o limite');
    const current=await this.io.read(e.path);
    if(current.etag!==source.etag||(!row.stageOnly&&current.readOnly))throw Error('Fonte mudou durante o planejamento');
    row.changes.push({path:e.path,before:source.body,after,previousHash:source.etag,nextHash:hash(after),applied:false});
   }
   if(row.stageOnly){
    row.status='staged';row.message='Alteração preparada para revisão; os arquivos originais permanecem intactos.';
    row.artifact=await this.io.stage(row);row.validation='Trechos e versões conferidos. Eficácia não testada; requer revisão no fluxo do repositório.';this.save();return row;
   }
   row.status='applying';row.message='Aplicando e relendo alterações.';this.save();
   for(const c of row.changes){
    // Persist intent first, so recovery can identify a write completed before a crash.
    c.intent=true;this.save();
    await this.io.write({path:c.path,body:c.after,etag:c.previousHash});
    c.applied=true;this.save();
    const reread=await this.io.read(c.path);
    if(reread.etag!==c.nextHash)throw Error('Resultado não corresponde à alteração planejada');
    c.verified=true;this.save();
   }
   row.status='done';row.message=plan.summary;row.validation='Conteúdo aplicado e relido via MCP; eficácia da melhoria ainda não medida.';row.finishedAt=new Date().toISOString();this.save();return row;
  }catch(e){
   row.message=e.message;row.status='failed';this.save();
   await this.restore(row,'rolled_back');return row;
  }
 }
 async restore(row,success='undone'){
  if(this.locks.has(row.id))throw Error('Restauração em andamento');
  this.locks.add(row.id);
  try{
   for(const c of [...row.changes].reverse()){
    if(c.restored||!c.intent)continue;
    const current=await this.io.read(c.path);
    if(current.etag===c.previousHash){c.restored=true;this.save();continue}
    if(current.etag!==c.nextHash){row.status='conflict';row.message='O arquivo mudou depois da execução. Desfazer foi interrompido para preservar sua edição.';this.save();return row}
    await this.io.write({path:c.path,body:c.before,etag:c.nextHash});
    if((await this.io.read(c.path)).etag!==c.previousHash)throw Error('Não foi possível confirmar restauração');
    c.restored=true;this.save();
   }
   row.status=success;row.restoredAt=new Date().toISOString();this.save();return row;
  }catch(e){row.status='conflict';row.message=e.message;this.save();return row}finally{this.locks.delete(row.id)}
 }
 async undo(jobId){
  const row=this.find(jobId);if(!row)throw Error('Execução não encontrada');
  if(['planning','applying'].includes(row.status))throw Error('Aguarde a execução terminar antes de desfazer');
  if(row.status==='staged'){row.status='withdrawn';row.message='Proposta retirada; nenhum original foi alterado.';await this.io.stage(row);this.save();return row}
  return this.restore(row);
 }
 async recover(){
  for(const row of this.rows){
   if(row.status==='planning'){row.status='failed';row.message='Planejamento interrompido. Tente novamente.';this.save()}
   if(row.status==='applying'){row.message='Execução interrompida; restaurando a versão anterior.';await this.restore(row,'rolled_back')}
  }
 }
}
