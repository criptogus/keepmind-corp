import { Memory } from '../src/main/services/brain/memory-store'
import { SpaceKeys, InMemorySecretStore } from '../src/main/services/security/keys'
import { createProjectAnalysisService } from '../src/main/services/project-analysis'
import { createContinuityService } from '../src/main/services/continuity'
import { describe, it, expect } from 'vitest'
import { ContinuityService, withProjectLock, assertNoSymlinkPath } from '../tools/lib/continuity.mjs'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fixture() {
  const files = new Map<string,string>(); let space = 'personal'; let readonly = false
  const service = () => new ContinuityService({ read: p => files.get(p) ?? null, write: (p,c) => { if(readonly) throw Error('READ_ONLY'); files.set(p,c) }, list: d => [...files.keys()].filter(p=>p.startsWith(d+'/') && !p.slice(d.length+1).includes('/')).map(p=>p.slice(d.length+1)), assertEvidencePath:()=>{}, scopePath:p => space==='personal'?p:`spaces/${space}/${p}`, space:()=>space, withLock: (_p,fn)=>fn() })
  return {files, service, setSpace:(s:string)=>{space=s}, setReadonly:()=>{readonly=true}}
}
describe('project continuity',()=>{
  it('persists a decision, review, attempt and evidence-based observation across reloads',()=>{
    const f=fixture(), s=f.service(); f.files.set('notes/source.md','---\nclass: sensitive\nspace: personal\n---\nOriginal source')
    let p=s.dispatch('create',{title:'Fictional launch',objective:'Explore',evidence:['notes/source.md']})
    const step=(action:string,args:Record<string,unknown>,actor:'human'|'agent'='agent') => p=s.dispatch(action,{projectId:p.id,expectedRevision:p.revision,...args},actor)
    step('add_decision',{choice:'Try blue',alternatives:['Use red'],expectedOutcome:'Higher clarity',evidence:['notes/source.md']})
    const decisionId=p.decisions[0].id
    expect(()=>step('review_decision',{decisionId,status:'accepted'})).toThrow('HUMAN_REQUIRED')
    step('review_decision',{decisionId,status:'accepted'},'human')
    step('add_attempt',{approach:'Red',result:'Too dark',reason:'Poor visibility'})
    expect(()=>step('record_outcome',{decisionId,executionStatus:'completed',observedResult:'Visible',lesson:'Useful',lessonConfirmed:true})).toThrow('HUMAN_REQUIRED')
    step('record_outcome',{decisionId,executionStatus:'completed',observedResult:'Visible',evidence:['notes/source.md']})
    step('add_question',{question:'Low?',priority:'low'}); step('add_question',{question:'High?',priority:'high'})
    const bundle=f.service().dispatch('context',{projectId:p.id}); expect(bundle.acceptedDecisions[0].expectedOutcome).toBe('Higher clarity'); expect(bundle.attempts[0].approach).toBe('Red'); expect(bundle.openQuestions[0].question).toBe('High?'); expect(bundle.evidence.every((x:any)=>x.status==='verified')).toBe(true)
    expect(()=>s.dispatch('update',{projectId:p.id,expectedRevision:1,title:'Stale'})).toThrow('REVISION_CONFLICT')
    f.files.set('notes/source.md','Changed source'); const changed=s.dispatch('check',{projectId:p.id}); expect(changed.impacts.some((i:any)=>i.kind==='decision' && i.status==='changed')).toBe(true)
    expect(s.dispatch('get',{projectId:p.id}).decisions[0].expectedOutcome).toBe('Higher clarity')
    f.files.delete('notes/source.md'); expect(s.dispatch('check',{projectId:p.id}).impacts.every((i:any)=>i.status==='unavailable')).toBe(true)
  })
  it('rejects traversal, foreign evidence, corrupt records and writes on read-only adapters',()=>{
    const f=fixture(), s=f.service(); f.files.set('notes/foreign.md','---\nspace: other\n---\nforeign')
    expect(()=>s.dispatch('create',{title:'x',evidence:['../secret.md']})).toThrow(); expect(()=>s.dispatch('create',{title:'x',evidence:['notes/foreign.md']})).toThrow('EVIDENCE_UNAVAILABLE')
    const p=s.dispatch('create',{title:'x'}); const path=`projects/${p.id}.md`; f.files.set(path,'broken'); expect(()=>s.dispatch('update',{projectId:p.id,expectedRevision:1,title:'overwrite'})).toThrow('CORRUPT_PROJECT'); expect(f.files.get(path)).toBe('broken')
    f.setReadonly(); expect(()=>s.dispatch('create',{title:'x'})).toThrow('READ_ONLY')
  })
  it('preserves frontmatter and refuses a concurrent lock',()=>{
    const f=fixture(), s=f.service(); let p=s.dispatch('create',{title:'x'}); const path=`projects/${p.id}.md`; f.files.set(path,f.files.get(path)!.replace('class: internal','class: sensitive')); p=s.dispatch('update',{projectId:p.id,expectedRevision:p.revision,title:'y'}); expect(f.files.get(path)).toContain('class: sensitive')
    const root=mkdtempSync(join(tmpdir(),'continuity-')); const file=join(root,'p.md'); mkdirSync(file+'.lock'); expect(()=>withProjectLock(file,()=>{})).toThrow('PROJECT_LOCKED'); rmSync(root,{recursive:true,force:true})
  })
  it('derives gaps, deduplicates feedback, and propagates decision evidence impacts',()=>{
    const f=fixture(), s=f.service(); f.files.set('notes/source.md','source'); let p=s.dispatch('create',{title:'x'});
    const step=(action:string,args:Record<string,unknown>,actor:'human'|'agent'='agent') => p=s.dispatch(action,{projectId:p.id,expectedRevision:p.revision,...args},actor)
    let context=s.dispatch('context',{projectId:p.id}); expect(context.missingQuestion.question).toContain('objective'); const interventionId=context.missingQuestion.interventionId;
    step('feedback',{interventionId,value:'useful'},'human'); step('feedback',{interventionId,value:'not_useful'},'human'); expect(p.feedback).toHaveLength(1)
    step('add_decision',{choice:'Plan',evidence:['notes/source.md']}); const decisionId=p.decisions[0].id
    step('add_artifact',{path:'notes/result.md',label:'Result',decisionIds:[decisionId]}); step('record_outcome',{decisionId,executionStatus:'completed',observedResult:'Observed'});
    f.files.set('notes/source.md','changed'); const check=s.dispatch('check',{projectId:p.id}); expect(check.impacts.some((x:any)=>x.kind==='artifact' && x.viaDecisionId===decisionId)).toBe(true)
    expect(s.dispatch('context',{projectId:p.id}).outcomes[0].evidenceStatus).toBe('unverified'); f.files.delete('notes/source.md'); step('update',{nextStep:'Review'}); expect(p.nextStep).toBe('Review')
  })

  it('enforces a byte budget for the complete handoff without truncating',()=>{
    const f=fixture(), s=f.service(); let p=s.dispatch('create',{title:'Projeto'});
    p=s.dispatch('add_decision',{projectId:p.id,expectedRevision:p.revision,choice:'Escolha',rationale:'á'.repeat(2000)});
    expect(()=>s.dispatch('context',{projectId:p.id,maxBytes:1024})).toThrow('CONTEXT_BUDGET_EXCEEDED');
    expect(()=>s.dispatch('context',{projectId:p.id,maxBytes:1023})).toThrow('INVALID_CONTEXT_BUDGET');
    const packet=s.dispatch('context',{projectId:p.id,maxBytes:100000}); expect(packet.proposals[0].rationale).toBe('á'.repeat(2000)); expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThanOrEqual(100000)
    for(let n=0;n<35;n++) p=s.dispatch('add_attempt',{projectId:p.id,expectedRevision:p.revision,approach:'á'.repeat(3000)});
    expect(()=>s.dispatch('context',{projectId:p.id})).toThrow('CONTEXT_BUDGET_EXCEEDED');
    expect(s.dispatch('context',{projectId:p.id,maxBytes:1024*1024}).attempts).toHaveLength(35);
  })
  it('accepts Portuguese names while denying traversal, reserved roots and platform paths',()=>{
    const f=fixture(), s=f.service(); const note='notes/Planejamento/Decisão e ação.md'; f.files.set(note,'fonte');
    const p=s.dispatch('create',{title:'Projeto',evidence:[note]}); expect(s.dispatch('check',{projectId:p.id}).evidence[0].status).toBe('verified');
    for(const path of ['notes/../fonte.md','/notes/fonte.md','notes\\fonte.md','C:/segredo.md','ops/ação.md','projects/ação.md','spaces/outro/ação.md','notes/.segredo.md']) expect(()=>s.dispatch('create',{title:'x',evidence:[path]})).toThrow('EVIDENCE_PATH_DENIED');
  })
  it('lists healthy projects and explicitly identifies authorized corrupt records without exposing foreign projects',()=>{
    const f=fixture(), s=f.service(); const healthy=s.dispatch('create',{title:'Healthy'}); const corrupt=s.dispatch('create',{title:'Corrupt'}); const foreign=s.dispatch('create',{title:'Private'});
    f.files.set(`projects/${corrupt.id}.md`,'broken'); f.files.set(`projects/${foreign.id}.md`,'---\nspace: other\n---\nprivate');
    const list=s.dispatch('list'); expect(list).toEqual(expect.arrayContaining([expect.objectContaining({id:healthy.id,title:'Healthy'}),{id:corrupt.id,error:'CORRUPT_PROJECT'}])); expect(list).toHaveLength(2); expect(JSON.stringify(list)).not.toContain('Private');
  })
  it('keeps human review history and rejects agent feedback',()=>{
    const f=fixture(), s=f.service(); let p=s.dispatch('create',{title:'x'}); p=s.dispatch('add_decision',{projectId:p.id,expectedRevision:p.revision,choice:'A'}); const decisionId=p.decisions[0].id;
    p=s.dispatch('review_decision',{projectId:p.id,expectedRevision:p.revision,decisionId,status:'accepted',reason:'yes'},'human'); p=s.dispatch('review_decision',{projectId:p.id,expectedRevision:p.revision,decisionId,status:'superseded',reason:'new evidence'},'human');
    expect(s.dispatch('get',{projectId:p.id}).decisions[0].reviews?.map(r=>r.status)).toEqual(['accepted','superseded']);
    const interventionId=s.dispatch('context',{projectId:p.id}).missingQuestion!.interventionId; expect(()=>s.dispatch('feedback',{projectId:p.id,expectedRevision:p.revision,interventionId,value:'useful'})).toThrow('HUMAN_REQUIRED');
  })

  it('rejects source and artifact symlinks even when they stay inside memory root',()=>{
    const root=mkdtempSync(join(tmpdir(),'continuity-symlink-'));
    try {
      mkdirSync(join(root,'notes')); mkdirSync(join(root,'projects')); mkdirSync(join(root,'spaces')); mkdirSync(join(root,'spaces','foreign'));
      writeFileSync(join(root,'notes','source.md'),'safe'); writeFileSync(join(root,'projects','protected.md'),'private'); writeFileSync(join(root,'spaces','foreign','other.md'),'foreign');
      symlinkSync(join(root,'projects'),join(root,'notes','link')); symlinkSync(join(root,'spaces','foreign'),join(root,'notes','foreign'));
      expect(()=>assertNoSymlinkPath(root,'notes/link/protected.md')).toThrow('EVIDENCE_PATH_DENIED');
      expect(()=>assertNoSymlinkPath(root,'notes/foreign/other.md')).toThrow('EVIDENCE_PATH_DENIED');
      expect(()=>assertNoSymlinkPath(root,'notes/source.md')).not.toThrow();
      const files=new Map<string,string>([['notes/link/protected.md','private'],['notes/source.md','safe']]);
      const s=new ContinuityService({read:p=>files.get(p)??null,write:(p,c)=>{files.set(p,c)},list:()=>[],scopePath:p=>p,space:()=> 'personal',withLock:(_p,fn)=>fn(),assertEvidencePath:p=>assertNoSymlinkPath(root,p)});
      expect(()=>s.dispatch('create',{title:'x',evidence:['notes/link/protected.md']})).toThrow('EVIDENCE_UNAVAILABLE');
      let p=s.dispatch('create',{title:'x',evidence:['notes/source.md']});
      expect(()=>s.dispatch('add_artifact',{projectId:p.id,expectedRevision:p.revision,path:'notes/link/protected.md',label:'x'})).toThrow('ARTIFACT_PATH_DENIED');
      rmSync(join(root,'notes','source.md')); symlinkSync(join(root,'projects','protected.md'),join(root,'notes','source.md'));
      expect(s.dispatch('check',{projectId:p.id}).evidence[0].status).toBe('unavailable');
    } finally { rmSync(root,{recursive:true,force:true}) }
  })

  it('rejects a project directory symlink even when it contains a valid project record',()=>{
    const root=mkdtempSync(join(tmpdir(),'continuity-project-link-'));
    try {
      mkdirSync(join(root,'notes')); const files=new Map<string,string>();
      const s=new ContinuityService({read:p=>files.get(p)??null,write:(p,c)=>{files.set(p,c)},list:()=>[...files.keys()].filter(p=>p.startsWith('projects/')).map(p=>p.slice(9)),scopePath:p=>p,space:()=> 'personal',withLock:(_p,fn)=>fn(),assertEvidencePath:p=>assertNoSymlinkPath(root,p)});
      const p=s.dispatch('create',{title:'Original'});
      writeFileSync(join(root,'notes',`${p.id}.md`),files.get(`projects/${p.id}.md`)!);
      symlinkSync(join(root,'notes'),join(root,'projects'));
      expect(()=>s.dispatch('get',{projectId:p.id})).toThrow('EVIDENCE_PATH_DENIED');
      expect(()=>s.dispatch('list')).toThrow('EVIDENCE_PATH_DENIED');
      expect(()=>s.dispatch('update',{projectId:p.id,expectedRevision:p.revision,title:'Forged'})).toThrow('EVIDENCE_PATH_DENIED');
    } finally { rmSync(root,{recursive:true,force:true}) }
  })

  it('runs model callback on authorized filesystem sources and preserves human reviews',async()=>{
    const root=mkdtempSync(join(tmpdir(),'continuity-analysis-')); mkdirSync(join(root,'notes')); mkdirSync(join(root,'projects'));
    try {
      writeFileSync(join(root,'notes','evidência.md'),'---\nspace: personal\nclass: sensitive\n---\nA fase termina em junho.');
      const s=new ContinuityService({read:p=>existsSync(join(root,p))?readFileSync(join(root,p),'utf8'):null,write:(p,c)=>writeFileSync(join(root,p),c),list:p=>readdirSync(join(root,p)),scopePath:p=>p,space:()=> 'personal',withLock:(p,fn)=>withProjectLock(join(root,p),fn),assertEvidencePath:p=>assertNoSymlinkPath(root,p)});
      let p=s.dispatch('create',{title:'Exemplo',evidence:['notes/evidência.md']}); p=s.dispatch('add_decision',{projectId:p.id,expectedRevision:p.revision,choice:'Entrega em maio',expectedOutcome:'Concluir fase'}); const decisionId=p.decisions[0].id;
      p=s.dispatch('record_outcome',{projectId:p.id,expectedRevision:p.revision,decisionId,executionStatus:'completed',observedResult:'Concluiu em junho',lesson:'Planejar prazo',evidence:['notes/evidência.md']}); const outcomeId=p.outcomes[0].id;
      p=await s.analyze({projectId:p.id,expectedRevision:p.revision},async ({user})=>{ const input=JSON.parse(user); expect(input.sources[0].content).toContain('junho'); return JSON.stringify({summary:'Diferença de prazo',findings:[{decisionId,relationship:'possible_contradiction',explanation:'Datas diferem',sourcePath:'notes/evidência.md',quote:'A fase termina em junho.'}],outcomeAssessments:[{outcomeId,comparison:'Mais tarde que esperado',evidenceLevel:'limited',sourcePath:'notes/evidência.md',quote:'A fase termina em junho.'}]}) },{provider:'example',model:'fictional'});
      const report=p.analysisReports[0]; expect(report.provider).toBe('example'); expect(report.findings[0].status).toBe('proposed'); expect(report.outcomeAssessments[0].causality).toBe('not_established'); expect(s.dispatch('context',{projectId:p.id}).analysisReports[0].stale).toBe(false);
      expect(()=>s.dispatch('review_analysis',{projectId:p.id,expectedRevision:p.revision,reportId:report.id,findingId:report.findings[0].id,status:'confirmed',reason:'checked',actor:'human'})).toThrow('HUMAN_REQUIRED');
      p=s.dispatch('review_analysis',{projectId:p.id,expectedRevision:p.revision,reportId:report.id,findingId:report.findings[0].id,status:'confirmed',reason:'checked'},'human');
      p=s.dispatch('review_outcome_lesson',{projectId:p.id,expectedRevision:p.revision,outcomeId,status:'confirmed',reason:'reviewed'},'human'); expect(p.outcomes).toHaveLength(1); expect(p.outcomes[0].lessonReviews?.[0].status).toBe('confirmed');
      writeFileSync(join(root,'notes','evidência.md'),'updated'); expect(s.dispatch('context',{projectId:p.id}).analysisReports[0].stale).toBe(true);
      rmSync(join(root,'notes','evidência.md')); const hidden=s.dispatch('get',{projectId:p.id}).analysisReports[0]; expect(hidden.sourceUnavailable).toBe(true); expect(hidden.findings[0].quote).toBe(''); expect(hidden.summary).toBe(''); expect(s.dispatch('context',{projectId:p.id}).analysisReports[0].summary).toBe('');
    } finally {rmSync(root,{recursive:true,force:true})}
  })
  it('rejects fabricated quotes, IDs and source changes during model execution',async()=>{
    const f=fixture(), s=f.service(); f.files.set('notes/a.md','source alpha'); let p=s.dispatch('create',{title:'x',evidence:['notes/a.md']}); p=s.dispatch('add_decision',{projectId:p.id,expectedRevision:p.revision,choice:'x'}); const decisionId=p.decisions[0].id;
    const args={projectId:p.id,expectedRevision:p.revision}; const response=(quote:string,id=decisionId)=>JSON.stringify({summary:'x',findings:[{decisionId:id,relationship:'possible_contradiction',explanation:'x',sourcePath:'notes/a.md',quote}],outcomeAssessments:[]});
    await expect(s.analyze(args,async()=>response('invented'))).rejects.toThrow('INVALID_ANALYSIS_RESPONSE');
    await expect(s.analyze(args,async()=>response('alpha','00000000-0000-0000-0000-000000000000'))).rejects.toThrow('INVALID_ANALYSIS_RESPONSE');
    await expect(s.analyze(args,async()=>{f.files.set('notes/a.md','new');return response('alpha')})).rejects.toThrow('STALE_ANALYSIS');
    expect(s.dispatch('get',{projectId:p.id}).analysisReports).toHaveLength(0);
  })
  it('rejects cross-space sources and concurrent project revisions during analysis',async()=>{
    const f=fixture(), s=f.service(); f.files.set('notes/a.md','ok'); let p=s.dispatch('create',{title:'x',evidence:['notes/a.md']}); const args={projectId:p.id,expectedRevision:p.revision};
    await expect(s.analyze(args,async()=>{s.dispatch('update',{projectId:p.id,expectedRevision:p.revision,title:'changed'});return JSON.stringify({summary:'x',findings:[],outcomeAssessments:[]})})).rejects.toThrow('STALE_ANALYSIS');
    p=s.dispatch('get',{projectId:p.id}); f.files.set('notes/a.md','---\nspace: other\n---\nprivate'); await expect(s.analyze({projectId:p.id,expectedRevision:p.revision},async()=>{throw Error('MUST_NOT_CALL')})).rejects.toThrow('EVIDENCE_UNAVAILABLE');
  })

  it('rejects oversized total model context without calling the callback',async()=>{
    const f=fixture(), s=f.service(); let p=s.dispatch('create',{title:'x'});
    for(let n=0;n<36;n++) p=s.dispatch('add_decision',{projectId:p.id,expectedRevision:p.revision,choice:'x',rationale:'z'.repeat(4000)});
    let called=false; await expect(s.analyze({projectId:p.id,expectedRevision:p.revision},async()=>{called=true;return '{}'})).rejects.toThrow('ANALYSIS_CONTEXT_BUDGET_EXCEEDED'); expect(called).toBe(false);
  })

  it('marks an analysis without sources as unverified and preserves initial lesson confirmation',async()=>{
    const f=fixture(), s=f.service(); let p=s.dispatch('create',{title:'x'}); p=s.dispatch('add_decision',{projectId:p.id,expectedRevision:p.revision,choice:'a'}); const decisionId=p.decisions[0].id;
    p=s.dispatch('record_outcome',{projectId:p.id,expectedRevision:p.revision,decisionId,executionStatus:'completed',observedResult:'x',lesson:'lesson',lessonConfirmed:true},'human');
    const outcomeId=p.outcomes[0].id; p=s.dispatch('review_outcome_lesson',{projectId:p.id,expectedRevision:p.revision,outcomeId,status:'rejected',reason:'reconsidered'},'human'); expect(p.outcomes[0].lessonReviews?.map(r=>r.status)).toEqual(['confirmed','rejected']);
    await expect(s.analyze({projectId:p.id,expectedRevision:p.revision},async()=>JSON.stringify({summary:'x',findings:[],outcomeAssessments:[{outcomeId,comparison:'Unsupported',evidenceLevel:'supported',sourcePath:'notes/fake.md',quote:'fake'}]}))).rejects.toThrow('INVALID_ANALYSIS_RESPONSE');
    p=await s.analyze({projectId:p.id,expectedRevision:p.revision},async()=>JSON.stringify({summary:'No sources',findings:[],outcomeAssessments:[{outcomeId,comparison:'Unverified',evidenceLevel:'none',sourcePath:null,quote:null}]}));
    expect(p.analysisReports[0].sourceEvidence).toBe('none'); expect(s.dispatch('context',{projectId:p.id}).analysisReports[0].outcomeAssessments[0].evidenceLevel).toBe('none');
  })

  it('rejects inconsistent stored review status and lesson confirmation',async()=>{
    const f=fixture(), s=f.service(); f.files.set('notes/a.md','source'); let p=s.dispatch('create',{title:'x',evidence:['notes/a.md']}); p=s.dispatch('add_decision',{projectId:p.id,expectedRevision:p.revision,choice:'x'}); const decisionId=p.decisions[0].id;
    p=s.dispatch('record_outcome',{projectId:p.id,expectedRevision:p.revision,decisionId,executionStatus:'completed',observedResult:'done',lesson:'x'});
    p=await s.analyze({projectId:p.id,expectedRevision:p.revision},async()=>JSON.stringify({summary:'x',findings:[{decisionId,relationship:'uncertain',explanation:'x',sourcePath:'notes/a.md',quote:'source'}],outcomeAssessments:[]}));
    const file=`projects/${p.id}.md`, original=f.files.get(file)!; const corrupt=(mutate:(v:any)=>void)=>{const match=original.match(/```json\n([\s\S]*?)\n```/)!;const data=JSON.parse(match[1]);mutate(data);f.files.set(file,original.replace(match[1],JSON.stringify(data)));expect(()=>s.dispatch('get',{projectId:p.id})).toThrow('CORRUPT_PROJECT')};
    corrupt(x=>{x.analysisReports[0].findings[0].status='confirmed'});
    corrupt(x=>{x.outcomes[0].lessonConfirmed=true;x.outcomes[0].lessonConfirmedAt=new Date().toISOString()});
  })
  it('allows 100 sources in a report and rejects 101',async()=>{
    const f=fixture(), s=f.service(); const paths=Array.from({length:101},(_,i)=>`notes/source-${i}.md`); paths.forEach(path=>f.files.set(path,'fictional source'));
    let p=s.dispatch('create',{title:'x'}); for(let i=0;i<4;i++) p=s.dispatch('add_decision',{projectId:p.id,expectedRevision:p.revision,choice:`choice ${i}`,evidence:paths.slice(i*25,i*25+25)});
    p=await s.analyze({projectId:p.id,expectedRevision:p.revision},async()=>JSON.stringify({summary:'x',findings:[],outcomeAssessments:[]})); expect(p.analysisReports[0].sources).toHaveLength(100); expect(s.dispatch('get',{projectId:p.id}).analysisReports[0].sources).toHaveLength(100);
    p=s.dispatch('add_decision',{projectId:p.id,expectedRevision:p.revision,choice:'extra',evidence:[paths[100]]}); await expect(s.analyze({projectId:p.id,expectedRevision:p.revision},async()=>{throw Error('called')})).rejects.toThrow('ANALYSIS_SOURCE_LIMIT');
  })
  it('persists analysis encrypted with classification inherited from a higher classified source',async()=>{
    const root=mkdtempSync(join(tmpdir(),'continuity-encrypted-')); try {
      const memory=new Memory(root,null); memory.keys=(await SpaceKeys.setup('fictional test password',new InMemorySecretStore())).keys;
      memory.write('notes/source.md','---\nclass: internal\nspace: personal\n---\nFictional original'); const continuity=createContinuityService(memory);
      let p=continuity.dispatch('create',{title:'Example',evidence:['notes/source.md']});
      memory.write('notes/source.md','---\nclass: sensitive\nspace: personal\n---\nFictional protected observation'); memory.classificationFloor='public';
      const analysis=createProjectAnalysisService(memory,async()=>JSON.stringify({summary:'Reviewed example',findings:[],outcomeAssessments:[]})); p=await analysis.analyze({projectId:p.id,expectedRevision:p.revision});
      const file=join(root,'projects',`${p.id}.md`); const ciphertext=readFileSync(file,'utf8'); expect(ciphertext.startsWith('KEEPMIND-ITEM:1\n')).toBe(true); expect(ciphertext).not.toContain('Reviewed example'); expect(memory.read(`projects/${p.id}.md`)).toContain('class: sensitive');
    } finally {rmSync(root,{recursive:true,force:true})}
  })

})
