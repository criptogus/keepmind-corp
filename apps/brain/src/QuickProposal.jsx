import React from 'react';
export function quickProposal(result={}){
 if(result.decision?.ready)return {action:result.decision.target+': '+result.decision.change,why:result.decision.benefit};
 const summary=String(result.summary||'').trim();
 const sentences=summary.split(/(?<=[.!?])\s+/);
 const explicit=sentences.find(s=>/^(proponho|proposta:|recomenda[çc][aã]o:|pr[oó]ximo passo:)/i.test(s));
 return {action:explicit||result.learning?.body||summary||result.skill?.name||'Proposta disponível',why:result.learning?.purpose||''};
}
export default function QuickProposal({result,busy,decide,children}){
 const {action,why}=quickProposal(result);
 return <article className="quick-proposal">
 <p className="quick-proposal-action">{action}</p>
 {why&&<p className="caption quick-proposal-why">{why}</p>}
 <div className="actions"><button className="primary" disabled={busy} onClick={()=>decide('accepted')}>Aceitar melhoria</button><button disabled={busy} onClick={()=>decide('dismissed')}>Dispensar</button></div>
 <details className="today-secondary"><summary>Detalhes e fontes</summary>{children}<button disabled={busy} onClick={()=>decide('resolved')}>Já resolvi</button></details>
 </article>
}
