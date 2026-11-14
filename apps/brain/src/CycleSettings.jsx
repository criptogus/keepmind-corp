import React,{useState} from 'react';
import {api} from './live-api';
const labels={'needs-usage-evidence':'Aguardando evidências de uso',queued:'Aguardando cota',testing:'Em teste',promoting:'Aplicando',promoted:'Melhorou no teste',rejected:'Versão anterior mantida',stale:'Fonte mudou',failed:'Teste interrompido','needs-suite':'Precisa de teste específico','rolled-back':'Versão restaurada'};
export default function CycleSettings({cycles,autonomy,act,refresh,focus}){
 const [evolutionOpen,setEvolutionOpen]=useState(focus==='evolution');
 const [archives,setArchives]=useState(null),[working,setWorking]=useState(false);
 const run=fn=>act(async()=>{setWorking(true);try{await fn();await refresh()}finally{setWorking(false)}});
 return <section className="panel">
  <h2>Ciclos do cérebro</h2>
  <p>{autonomy?.enabled?'Em segundo plano':'Pausados'} · 1 execução automática por 24 horas</p>
  <div className="setting"><div><h3>Inteligência e aprendizado</h3><p>{autonomy?.nextAt?'Próxima cota: '+new Date(autonomy.nextAt).toLocaleString('pt-BR'):'Aguardando primeira execução'}</p></div></div>
  <div className="setting"><div><h3>Limpeza reversível</h3><p>{cycles?.maintenance?`${cycles.maintenance.inspected} arquivos verificados · ${cycles.maintenance.archived} arquivados`:'Aguardando verificação'}</p></div><button disabled={working} onClick={()=>run(async()=>setArchives(await api('/cleanup')))}>Ver histórico</button></div>
  {archives&&<div>{archives.filter(a=>a.status==='archived').length===0?<p>Nenhum arquivo arquivado.</p>:archives.filter(a=>a.status==='archived').map(a=><div className="setting" key={a.id}><span>{a.path.split('/').at(-1)}</span><button disabled={working} onClick={()=>run(async()=>{await api('/cleanup/restore',{id:a.id});setArchives(await api('/cleanup'))})}>Restaurar</button></div>)}</div>}
  <details open={evolutionOpen} onToggle={e=>setEvolutionOpen(e.currentTarget.open)}><summary>Evolução de skills · {cycles?.trials?.filter(t=>t.status==='promoted').length||0} melhorias verificadas</summary>
   {!cycles?.trials?.length&&<p>Nenhuma comparação concluída.</p>}
   {cycles?.trials?.map(t=><div className="setting" key={t.id}><div><h3>{t.name||t.path.split('/').at(-1)}</h3><p>{labels[t.status]||t.status}</p><p>{t.runs.baseline?.evidence?`${t.runs.baseline.evidence.score}/${t.runs.baseline.evidence.total}`:'—'} → {t.runs.candidate?.evidence?`${t.runs.candidate.evidence.score}/${t.runs.candidate.evidence.total}`:'—'} · Evidências documentais</p><details><summary>Evidências do teste</summary><pre>{JSON.stringify(t,null,2)}</pre></details></div>{t.status==='promoted'&&<button disabled={working} onClick={()=>run(()=>api('/skill/rollback',{id:t.id}))}>Desfazer evolução</button>}</div>)}
  </details>
  {cycles?.error&&<p role="alert">Manutenção interrompida: {cycles.error}</p>}
 </section>
}
