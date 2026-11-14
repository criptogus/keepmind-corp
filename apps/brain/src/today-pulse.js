// Presentation of existing evidence only: no jobs, writes, or inferred gains.
export function todayPulse(today, jobs = [], connected = false, refreshError = '') {
  const a = today?.autonomy || {};
  const available = connected && today?.available === true && !refreshError;
  const latest = jobs.find(j => j.id === a.jobId);
  const mode = !available ? 'unavailable' : a.error || a.status === 'failed' ? 'error' : a.status === 'running' ? 'running' : !a.enabled ? 'paused' : 'ready';
  const title = {unavailable: today ? 'A memória precisa reconectar' : 'Conectando à sua memória', error: 'Uma análise precisa de atenção', running: 'Seu cérebro está analisando', paused: 'Análise automática pausada', ready: 'Seu cérebro está conectado'}[mode];
  const maintenance = today?.cycles?.maintenance;
  const blockers = (today?.cycles?.trials || []).filter(t => ['needs-usage-evidence','needs-suite','failed','stale'].includes(t.status));
  const events = [];
  if (available && latest?.status === 'done') events.push({id:latest.id, title:'Última análise concluída', detail:`${new Set(latest.reads || []).size} fontes consultadas`, at:latest.finishedAt || latest.startedAt, target:'job', jobId:latest.id});
  if (available && maintenance?.at) events.push({id:'maintenance',title:maintenance.failures?.length?'Verificação com pendências':'Memória verificada',warning:!!maintenance.failures?.length,detail:`${(Number.isFinite(maintenance.inspected)?maintenance.inspected.toLocaleString('pt-BR'):'—')} arquivos · ${Number.isFinite(maintenance.archived)?maintenance.archived:'—'} arquivados`,at:maintenance.at,target:'cycles'});
  return {mode,title,available,inventory:available ? today.inventory : null, events, blockers:available ? blockers : [], latest,
    nextAt:available && a.enabled && a.nextAt ? a.nextAt : null,
    noNews:available && mode==='ready' && a.noNews,
    error:mode==='error' ? a.error : refreshError,
    contextUsed:available ? today?.value?.contextUsed || 0 : null,
    tasks:available ? today?.value?.tasks || 0 : null};
}
