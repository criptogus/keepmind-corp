import React from 'react';
const labels={staged:'Alteração pronta para revisão',withdrawn:'Proposta retirada',planning:'Preparando melhoria…',applying:'Aplicando e validando…',done:'Melhoria aplicada',blocked:'Não foi possível aplicar',failed:'Execução interrompida',rolled_back:'Alteração revertida após falha',conflict:'Desfazer precisa de atenção',undone:'Melhoria desfeita'};
export default function ProposalExecution({row,busy,undo,retry}){
 return <article className="quick-proposal" aria-live="polite">
 <b>{labels[row.status]||row.status}</b><p>{row.message}</p>
 {row.validation&&row.status==='done'&&<p className="caption">{row.validation}</p>}
 {row.changes?.map(c=><details key={c.path}><summary>{c.path} · {c.restored?'restaurado':c.applied?'alterado':row.status==='staged'?'proposto':'não aplicado'}</summary><div className="proposal-diff"><div><h3>Antes</h3><pre>{c.before}</pre></div><div><h3>Depois</h3><pre>{c.after}</pre></div></div></details>)}
 <div className="actions">{['done','conflict','staged'].includes(row.status)&&<button disabled={busy} onClick={()=>undo(row.jobId)}>{row.status==='staged'?'Retirar proposta':'Desfazer melhoria'}</button>}
 {['blocked','failed','rolled_back'].includes(row.status)&&<button disabled={busy} onClick={()=>retry(row.jobId,'accepted')}>Tentar novamente</button>}</div>
 </article>
}
