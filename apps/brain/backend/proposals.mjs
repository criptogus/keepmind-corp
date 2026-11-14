// Fail closed for legacy or unsupported recommendations. History is unchanged.
export function clearDecision(job) {
  const d=job?.result?.decision;
  if(d?.ready!==true)return false;
  if(['target','change','benefit','evidence','evidencePath'].some(k=>typeof d[k]!=='string'||!d[k].trim()))return false;
  if(!job.result.sourcePaths?.includes(d.evidencePath)||!job.reads?.includes(d.evidencePath))return false;
  // Internal hand-offs are not decisions for the owner.
  if(/(?:devolver|encaminhar|escalar).{0,65}(?:coordenador|orquestrador)|ponto de retomada/i.test(d.change+' '+job.result.summary))return false;
  return true;
}
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const similarity = (a, b) => {
  const x = new Set(normalize(a).split(' ').filter(w => w.length > 2));
  const y = new Set(normalize(b).split(' ').filter(w => w.length > 2));
  if (!x.size || !y.size) return 0;
  return [...x].filter(w => y.has(w)).length / new Set([...x, ...y]).size;
};
const sameText = (a,b) => !!normalize(a) && (normalize(a) === normalize(b) || similarity(a,b) >= .82);
export function sameProposal(a, b) {
  if (!a || !b) return false;
  const samePrinciple = sameText(a.learning?.body,b.learning?.body) && sameText(a.learning?.purpose,b.learning?.purpose);
  const sameProcedure = sameText(a.skill?.name,b.skill?.name) && sameText(a.skill?.steps?.join(' '),b.skill?.steps?.join(' '));
  return samePrinciple || sameProcedure;
}
export function attentionDeliveries({jobs=[],learnings=[],skills=[],featuredId,now=Date.now()}) {
  const featured = jobs.find(j => j.id === featuredId);
  const sorted = [...jobs].sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));
  const shown=[];
  for (const j of sorted) {
    if(!clearDecision(j)||j.proposalDecision||j.status!=='done'||!j.result?.learning||!j.result?.skill||/^\s*SEM_NOVIDADE/i.test(j.result.summary||''))continue;
    // Older items remain accessible in History; Today is a review queue.
    if(!Number.isFinite(Date.parse(j.startedAt))||Date.parse(j.startedAt)<now-7*86400000)continue;
    if(j.id===featuredId||sameProposal(j.result,featured?.result)||shown.some(x=>sameProposal(j.result,x.result)))continue;
    const handledLearning=learnings.some(l=>['active','suspended','rejected','dismissed'].includes(l.status)&&sameText(l.body,j.result.learning.body)&&sameText(l.purpose,j.result.learning.purpose));
    const existingSkill=skills.some(s=>s.metadata&&sameText(s.metadata.name,j.result.skill.name)&&sameText(s.metadata.steps?.join(' '),j.result.skill.steps?.join(' ')));
    if(handledLearning||existingSkill)continue;
    shown.push(j);
  }
  return shown.slice(0,2);
}
