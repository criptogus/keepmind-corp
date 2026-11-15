import {promotionEvidence} from './skill-evolution.mjs';
const timestamp=v=>typeof v==='number'?v:Date.parse(v);
const complete=e=>e&&Array.isArray(e.cases)&&e.cases.length>0&&typeof e.model==='string'&&!!e.model&&typeof e.suiteHash==='string'&&Number.isFinite(e.score)&&Number.isFinite(e.total);
const distinct=rows=>[...new Map(rows.filter(r=>r?.id).map(r=>[r.id,r])).values()];
const evidence=(row,type='receipt')=>({id:row.id,type,path:row.receiptPath||row.path,jobId:row.jobId,label:row.task||row.name||row.goal||row.id,at:row.finishedAt||row.createdAt||row.at});
// Extract from the recorded result, never from the requested task.
export function resultSentence(summary){
 if(typeof summary!=='string')return '';
 const clean=summary.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/[*#`]/g,'').replace(/\s+/g,' ').trim();
 return clean.split(/(?<=[.!?])(?:\s+|(?=[A-ZÀ-Ý]))|(?<=[a-zà-ÿ][.!?])(?=\d)/u)[0]||'';
}
export function buildDashboard({usage=[],jobs=[],learnings=[],cycles={},executions=[],now=Date.now(),available=false,shared=false}={}){
 const day=new Date(now);day.setHours(0,0,0,0);
 const windows={};
 for(const [key,since] of [['today',day.getTime()],['7d',now-7*86400000],['30d',now-30*86400000]]){
  const within=v=>Number.isFinite(timestamp(v))&&timestamp(v)>=since&&timestamp(v)<=now;
  const rows=distinct(usage).filter(r=>r.mode==='keepmind'&&within(r.finishedAt||r.at));
  const work=distinct(jobs).filter(j=>!j.evaluation&&within(j.finishedAt||j.startedAt));
  const recorded=learnings.filter(l=>within(l.createdAt));
  const learnedPaths=new Map(learnings.map(l=>['learnings/'+l.id+'.md',l]));
  const contexts=rows.filter(r=>r.used?.some(s=>s.unchanged===true));
  const transferred=rows.filter(r=>r.used?.some(s=>s.unchanged===true&&learnedPaths.get(s.path)?.kind==='correction'&&learnedPaths.get(s.path)?.agent&&learnedPaths.get(s.path).agent!==r.agent));
  const learnedUse=rows.filter(r=>r.used?.some(s=>s.unchanged===true&&learnedPaths.has(s.path)));
  const trials=cycles.trials||[];
  const tested=trials.filter(t=>complete(t.runs?.baseline?.evidence)&&complete(t.runs?.candidate?.evidence)&&within(t.runs.candidate.evidence.finishedAt));
  const promoted=trials.filter(t=>t.status==='promoted'&&within(t.promotedAt)&&complete(t.runs?.baseline?.evidence)&&complete(t.runs?.candidate?.evidence)&&promotionEvidence(t.runs?.baseline?.evidence,t.runs?.candidate?.evidence));
  const rejected=tested.filter(t=>t.status==='rejected');
  const applied=executions.filter(r=>r.status==='done'&&within(r.finishedAt)&&r.changes?.some(c=>c.applied&&c.verified&&!c.restored));
  const updated=new Set(applied.flatMap(r=>r.changes.filter(c=>c.applied&&c.verified&&!c.restored).map(c=>c.path)));
  const usedSkills=new Set([...rows.flatMap(r=>(r.used||[]).filter(s=>s.unchanged&&s.path?.startsWith('skills/')).map(s=>s.path)),...work.filter(j=>j.status==='done'&&j.skillPath&&j.reads?.includes(j.skillPath)).map(j=>j.skillPath)]);
  const maintenance=cycles.maintenance&&within(cycles.maintenance.at)?cycles.maintenance:null;
  const metric=(id,label,value,detail,records=[])=>({id,label,value:available?value:null,detail,evidence:records});
  windows[key]={since:new Date(since).toISOString(),until:new Date(now).toISOString(),groups:[
   {title:'Uso pelos agentes',kind:'Atividade',metrics:[
    metric('tasks','Tarefas atendidas',shared?rows.length:null,'Tarefas encerradas registradas via MCP no modo KeepMind; inclui falhas e exclui a comparação com GitHub.',rows.map(r=>evidence(r))),
    metric('agents','Agentes ativos',shared?new Set(rows.map(r=>r.agent)).size:null,'Agentes com tarefas registradas neste período.',rows.map(r=>evidence(r))),
    metric('contexts','Contextos utilizados',shared?contexts.length:null,'Tarefas com uso declarado de contexto e versão conferida. Não comprova efeito na qualidade.',contexts.map(r=>evidence(r))),
    metric('queries','Consultas MCP',null,'O total de chamadas de todos os agentes ainda não é coletado. Fontes lidas não equivalem a consultas.')
   ]},
   {title:'Aprendizado e skills',kind:'Resultado registrado',metrics:[
    metric('corrections','Correções registradas',recorded.filter(l=>l.kind==='correction').length,'Correções criadas no período; não significa que foram aprovadas ou utilizadas.',recorded.filter(l=>l.kind==='correction').map(l=>({...evidence(l,'learning'),path:'learnings/'+l.id+'.md'}))),
    metric('learning-use','Tarefas com aprendizado',shared?learnedUse.length:null,'Uso relatado de aprendizado ou correção registrada; eficácia não comprovada.',learnedUse.map(r=>evidence(r))),
    metric('cross-agent','Uso por outro agente',shared?transferred.length:null,'Tarefas que declararam usar uma correção escrita por outro agente. Não significa erro evitado.',transferred.map(r=>evidence(r))),
    metric('skills-used','Skills utilizadas',usedSkills.size,'Skills distintas presentes nas leituras concluídas ou nos recibos de uso.',[...rows.filter(r=>r.used?.some(s=>s.unchanged&&s.path?.startsWith('skills/'))).map(r=>evidence(r)),...work.filter(j=>j.status==='done'&&j.skillPath&&j.reads?.includes(j.skillPath)).map(j=>({...evidence(j,'job'),jobId:j.id}))]),
    metric('tested','Versões comparadas',tested.length,'Comparações com evidência dos testes da versão atual e da candidata.',tested.map(t=>evidence(t,'trial'))),
    metric('promoted','Skills promovidas',promoted.length,'Promoções ainda vigentes que melhoraram no mesmo teste sem regressão. Não prova ganho em tarefas reais.',promoted.map(t=>evidence(t,'trial'))),
    metric('rejected','Versões rejeitadas',rejected.length,'Comparações concluídas sem melhoria suficiente para promoção.',rejected.map(t=>evidence(t,'trial')))
   ]},
   {title:'Organização da memória',kind:'Verificação e alterações',metrics:[
    metric('updated','Arquivos atualizados',updated.size,'Arquivos distintos aplicados e relidos via MCP; exclui propostas apenas preparadas e alterações desfeitas.',applied.map(r=>evidence(r,'execution'))),
    metric('archived','Arquivados na última verificação',maintenance?.archived??null,'Somente a última manutenção registrada dentro do período; não é um total acumulado.',maintenance?[{id:'maintenance',type:'cycles',label:'Última manutenção',at:maintenance.at}]:[]),
    metric('inspected','Verificados na última manutenção',maintenance?.inspected??null,'Arquivos verificados na última manutenção do período. Não é ganho nem soma de verificações.',maintenance?[{id:'maintenance',type:'cycles',label:'Última manutenção',at:maintenance.at}]:[]),
    metric('conflicts','Conflitos detectados',null,'Ainda não existe um histórico completo de conflitos. Duplicatas não são contadas como conflitos.')
   ]}
  ],gain:{value:null,label:'Ganho ainda não comprovado',detail:'Contagens mostram atividade e resultados registrados. Tempo economizado e erros evitados exigem uma comparação válida.'},timeline:available?[
   ...rows.map(r=>({id:r.id,type:'receipt',path:r.receiptPath,at:r.finishedAt||r.at,agent:r.agent,title:resultSentence(r.summary)||(r.outcome==='failure'?'A execução falhou sem registrar um resultado concreto.':'Nenhum resultado concreto foi registrado.'),result:r.outcome==='success'?'Conclusão relatada':r.outcome==='failure'?'Falha relatada':'Resultado não avaliado'})),
   ...applied.map(r=>({id:r.id,type:'execution',jobId:r.jobId,at:r.finishedAt,agent:'KeepMind',title:(()=>{const n=new Set(r.changes.filter(c=>c.applied&&c.verified&&!c.restored).map(c=>c.path)).size;return `${n} ${n===1?'arquivo atualizado e conferido':'arquivos atualizados e conferidos'} na memória.`})(),result:'Alteração aplicada e relida'})),
   ...tested.map(t=>({id:t.id,type:'trial',at:t.promotedAt||t.runs.candidate.evidence.finishedAt,agent:'KeepMind',title:`${t.name||t.path||'Skill'}: ${promoted.includes(t)?'nova versão promovida após melhoria comprovada nos testes':t.status==='rejected'?'versão anterior mantida após a comparação':'comparação entre versões registrada'}.`,result:promoted.includes(t)?'Promovida após teste':t.status==='rejected'?'Versão anterior mantida':'Comparação registrada'}))
  ].sort((a,b)=>timestamp(b.at)-timestamp(a.at)):[]};
 }
 return {available,generatedAt:new Date(now).toISOString(),windows,coverage:'Recibos persistidos e execuções locais disponíveis; agentes sem registro não entram nos números.'};
}
