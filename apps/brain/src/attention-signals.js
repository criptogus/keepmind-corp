// Evidence-backed review needs, not generated improvement proposals or proof of gain.
export function attentionSignals(today, learnings = []) {
  if (!today?.available) return [];
  const signals=[];
  const records=new Map((today.value?.records||[]).map(r=>[r.id,r]));
  for(const row of today.value?.recurringErrors||[]) {
    const evidence=[...new Set(row.ids||[])].map(id=>records.get(id)).filter(r=>r?.outcome==='failure'&&r.path);
    if(evidence.length<2||!row.key?.trim())continue;
    signals.push({id:'error:'+row.key,priority:0,title:`Investigar o erro “${row.key}”`,reason:`Relatado em ${evidence.length} tarefas. Confirme a causa antes de alterar uma skill.`,action:'Ver registros',target:'records',evidence});
  }
  for(const l of learnings) {
    if(l.status!=='suspended'||!l.id||!l.sourcePath)continue;
    signals.push({id:'learning:'+l.id,priority:1,title:`Revisar o aprendizado ligado a ${l.sourcePath.split('/').at(-1)}`,reason:'Está suspenso e não deve orientar os agentes antes da revisão.',action:'Revisar aprendizado',target:'learnings',evidence:[{id:l.id,path:l.sourcePath,task:'Fonte do aprendizado'}]});
  }
  const latest=new Map();
  const at=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0;
  for(const t of today.cycles?.trials||[]) {
    if(!t.path)continue;
    const previous=latest.get(t.path);
    if(!previous||at(t.createdAt)>=at(previous.createdAt))latest.set(t.path,t);
  }
  const reasons={'needs-usage-evidence':'Falta comprovar o uso real; a melhoria ainda não está demonstrada.','needs-suite':'Falta um teste específico para comparar a versão atual e a proposta.',failed:'A validação foi interrompida. Confira o erro antes de tentar novamente.',stale:'A fonte mudou desde a proposta. Revise a comparação antes de aplicar.'};
  for(const t of latest.values()) {
    if(!reasons[t.status]||!t.id)continue;
    signals.push({id:'trial:'+t.id,priority:2,title:`Validar “${t.name||t.path.split('/').at(-1)}”`,reason:reasons[t.status],action:'Ver validação',target:'evolution',evidence:[{id:t.id,path:t.path,task:t.name||t.path}]});
  }
  return [...new Map(signals.map(s=>[s.id,s])).values()].sort((a,b)=>a.priority-b.priority);
}
