import React from 'react';
import { Brain, ArrowRight, CheckCircle, PauseCircle, WarningCircle } from '@phosphor-icons/react';
import { todayPulse } from './today-pulse';
const number = value => Number.isFinite(value) ? value.toLocaleString('pt-BR') : '—';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : 'Horário indisponível';
export default function TodayPulse({today,jobs,connected,refreshError,onMemory,onSkills,onLearnings,onCycles,onJob,onRefresh,onReviewEvolution}) {
  const p=todayPulse(today,jobs,connected,refreshError);
  return <section className={'brain-pulse brain-pulse--'+p.mode} aria-label="Estado do cérebro">
    <div className="brain-pulse-main"><Brain className="brain-pulse-symbol" size={52} weight="duotone" aria-hidden="true"/><div>
      <h2>{p.title}</h2>
      <p className="caption">{p.mode==='running'?'Consultando fontes e verificando possíveis melhorias.':p.noNews?'A última análise não gerou uma proposta nova para você.':p.mode==='paused'?'Sua memória continua disponível aos agentes.':p.mode==='error'?'Confira a execução antes da próxima análise.':p.available?'Memória disponível para o próximo trabalho dos seus agentes.':'O estado será atualizado quando a conexão responder.'}</p>
    </div>{p.mode==='unavailable'&&<button onClick={onRefresh}>Reconectar</button>}</div>
    {p.inventory && <div className="brain-pulse-inventory" aria-label="Acervo conectado">
      <button onClick={onMemory}><strong>{number(p.inventory.notes)}</strong> notas<ArrowRight/></button>
      <button onClick={onSkills}><strong>{number(p.inventory.skills)}</strong> skills<ArrowRight/></button>
      <button onClick={onLearnings}><strong>{number(p.inventory.activeLearnings)}</strong> aprendizados ativos<ArrowRight/></button>
    </div>}
    <div className="brain-pulse-schedule"><span className="brain-pulse-status"><i aria-hidden="true"/>{p.mode==='running'?'Em execução':p.mode==='ready'?'Aguardando a próxima janela':p.mode==='paused'?'Automação pausada':p.mode==='error'?'Execução interrompida':'Conectando'}</span>{p.nextAt&&<button className="textlink" onClick={onCycles}>{Date.parse(p.nextAt)<=Date.now()?'Janela disponível':'Próxima janela · '+date(p.nextAt)}<ArrowRight/></button>}</div>
    {p.error&&<details className="brain-pulse-error"><summary>Detalhes da falha</summary><p>{p.error}</p>{p.latest&&<button onClick={()=>onJob(p.latest.id)}>Ver execução</button>}</details>}
    {p.blockers.length>0&&<div className="brain-pulse-blocker"><PauseCircle size={22} aria-hidden="true"/><div><strong>{p.blockers.length===1?'Uma evolução de skill aguarda validação':`${p.blockers.length} evoluções de skills aguardam validação`}</strong><p className="caption">Faltam evidências de uso ou testes concluídos.</p></div><button onClick={onReviewEvolution || onCycles}>Ver evidências<ArrowRight/></button></div>}
    {p.events.length>0&&<div className="brain-pulse-events" aria-label="Trabalho registrado">{p.events.map(e=><button className="brain-pulse-event" key={e.id} onClick={()=>e.target==='job'?onJob(e.jobId):onCycles()}>{e.warning?<WarningCircle size={20} aria-hidden="true"/>:<CheckCircle size={20} aria-hidden="true"/>}<span><strong>{e.title}</strong><small>{e.detail}</small></span><time dateTime={e.at}>{date(e.at)}</time><ArrowRight/></button>)}</div>}
    {p.available&&p.tasks>0&&<p className="brain-pulse-usage caption">Nos últimos 7 dias: {p.tasks} tarefas registradas · contexto usado em {p.contextUsed}, segundo os agentes.</p>}
  </section>;
}
