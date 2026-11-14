import React from 'react';
import CycleSettings from './CycleSettings';
export default function RealHealth({today,status,onMetric,act,refresh,openNote}){
 const available=today?.available===true&&status?.unlocked===true&&!status?.error,inv=available?today.inventory:null;
 return <>
  <section className="panel">
   <h2>Memória real</h2>
   <div className="metrics">
    <div><b>{inv?.notes??'—'}</b><span>Notas</span></div>
    <div><b>{inv?.skills??'—'}</b><span>Skills</span></div>
    <div><b>{inv?.activeLearnings??'—'}</b><span>Aprendizados ativos</span></div>
    <div><b>{inv?.pendingLearnings??'—'}</b><span>Aguardando revisão</span></div>
   </div>
   <p>{available?'Memória conectada via MCP':'Dados da memória indisponíveis'} · Codex {status?.codexAvailable?'disponível':'indisponível'}</p>
   <button onClick={()=>act(refresh)}>Atualizar</button>
  </section>
  <section className="panel">
   <h2>Uso observado</h2><p>{today?.window||'Aguardando registros reais'}</p>
   <div className="today-metrics">{(today?.metrics||[]).map(m=><button className="today-metric" key={m.label} disabled={!available} onClick={()=>onMetric(m)}><strong>{available?(m.value??'—'):'—'}</strong><span>{m.label}</span></button>)}</div>
   <p className="caption">Conclusão técnica não mede qualidade. Abra um indicador para ver as execuções.</p>
  </section>
  {available&&today.cycles&&<CycleSettings cycles={today.cycles} autonomy={today.autonomy} act={act} refresh={refresh}/>}
  {available&&today?.cycles?.lastWeeklyResult?.path&&<button onClick={()=>openNote(today.cycles.lastWeeklyResult.path)}>Ver revisão semanal</button>}
 </>
}
