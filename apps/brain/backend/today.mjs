// Read-only projection. Never changes memory, MCP clients, keys or sync settings.
export function buildToday({notes=[],learnings=[],skills=[],jobs=[],available=false,historyPersisted=false,now=Date.now()}) {
  const since=now-7*86400000;
  const recent=jobs.filter(j=>Date.parse(j.startedAt)>=since);
  const completed=recent.filter(j=>j.status==='done');
  const failed=recent.filter(j=>j.status==='failed');
  const finished=completed.length+failed.length;
  const active=learnings.filter(l=>l.status==='active');
  const pending=learnings.filter(l=>l.status==='pending');
  const metrics=[
    {label:'Fontes consultadas',value:new Set(recent.flatMap(j=>j.reads||[])).size,detail:'Fontes distintas lidas pelo Codex via MCP',evidence:recent.filter(j=>j.reads?.length).map(j=>j.id)},
    {label:'Execuções concluídas',value:completed.length,detail:'Resultado com leitura MCP comprovada',evidence:completed.map(j=>j.id)},
    {label:'Conclusão técnica',value:finished?Math.round(completed.length/finished*100)+'%':null,detail:`${completed.length} concluídas / ${finished} encerradas; exclui canceladas. Não mede qualidade.`,evidence:[...completed,...failed].map(j=>j.id)},
    {label:'Reutilizações de skills',value:completed.filter(j=>j.skillPath).length,detail:'Execuções concluídas com uma skill selecionada',evidence:completed.filter(j=>j.skillPath).map(j=>j.id)},
  ];
  const insights=[];
  if(available){
    if(pending.length)insights.push({id:'pending',title:'Aprendizados aguardam revisão',detail:`${pending.length} propostas ainda não entraram na memória ativa.`,action:'Revisar aprendizados',target:'learnings',sources:pending.map(l=>({id:l.id,label:l.body}))});
    const unused=active.filter(l=>!skills.some(s=>s.metadata?.learningId===l.id));
    if(unused.length)insights.push({id:'skills',title:'Conhecimento pronto para virar procedimento',detail:`${unused.length} aprendizados ativos ainda não estão vinculados a uma skill.`,action:'Transformar em skill',target:'learnings',sources:unused.map(l=>({id:l.id,label:l.body}))});
    const inactive=skills.filter(s=>s.metadata?.learningId&&!active.some(l=>l.id===s.metadata.learningId));
    if(inactive.length)insights.push({id:'review-skills',title:'Skills precisam de revisão da origem',detail:`${inactive.length} skills referenciam aprendizados que não estão ativos neste escopo. Revise antes de reutilizar.`,action:'Revisar skills',target:'skills',sources:inactive.map(s=>({path:s.path,label:s.metadata?.name||s.title}))});
    const legacy=skills.filter(s=>!s.metadata?.learningId);
    if(legacy.length)insights.push({id:'legacy-skills',title:'Tornar a origem das skills rastreável',detail:`${legacy.length} skills existentes não têm vínculo com um aprendizado registrado nesta ponte. Isso não indica ausência de origem no acervo; revise e documente o vínculo antes de medir evolução.`,action:'Examinar skills existentes',target:'skills',sources:legacy.slice(0,20).map(s=>({path:s.path,label:s.title}))});
    if(notes.length)insights.push({id:'explore',title:'Investigar conexões e lacunas',detail:'Peça ao Codex uma análise com fontes. Esta é uma proposta de investigação; nenhuma contradição foi confirmada automaticamente.',action:'Preparar análise',target:'analysis',sources:[]});
  }
  return {available,generatedAt:new Date(now).toISOString(),window:historyPersisted?'Últimos 7 dias de registros desta ponte':'Últimos 7 dias, limitada à sessão atual da ponte',metrics:metrics.map(m=>({...m,value:available?m.value:null})),inventory:available?{notes:notes.filter(n=>n.kind!=='Skill').length,activeLearnings:active.length,pendingLearnings:pending.length,skills:skills.length}:null,insights,activity:recent.map(j=>({id:j.id,goal:j.goal,status:j.status,provider:j.provider,startedAt:j.startedAt,reads:j.reads||[],skillPath:j.skillPath})).reverse()};
}
