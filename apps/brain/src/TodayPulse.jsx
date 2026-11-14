import React from 'react';
import { Brain, ArrowRight, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { attentionSignals } from './attention-signals';
import { todayPulse } from './today-pulse';
const number = value => Number.isFinite(value) ? value.toLocaleString('pt-BR') : '—';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : 'Horário indisponível';
export default function TodayPulse({today,jobs,connected,refreshError,onMemory,onSkills,onLearnings,onCycles,onJob,onRefresh,onReviewEvolution,learnings=[],openNote}) {
  const p=todayPulse(today,jobs,connected,refreshError);
  const signals=p.available?attentionSignals(today,learnings):[];
  return <section className={'brain-pulse brain-pulse--'+p.mode} aria-label="Estado do cérebro">
    <div className="brain-pulse-main"><Brain className="brain-pulse-symbol" size={52} weight="duotone" aria-hidden="true"/><div>
      <h2>{p.title}</h2>
      <p className="caption">{p.mode==='running'?'Consultando fontes e verificando possíveis melhorias.':p.noNews?'A última análise não gerou uma proposta nova para você.':p.mode==='paused'?'Sua memória continua disponível aos agentes.':p.mode==='error'?'Confira a execução antes da próxima análise.':p.available?'Memória disponível para o próximo trabalho dos seus agentes.':'O estado será atualizado quando a conexão responder.'}</p>
    </div>{p.mode==='unavailable'&&<button onClick={onRefresh}>Reconectar</button>}</div>
    <div className="brain-pulse-schedule"><span className="brain-pulse-status"><i aria-hidden="true"/>{p.mode==='running'?'Em execução':p.mode==='ready'?'Aguardando a próxima janela':p.mode==='paused'?'Automação pausada':p.mode==='error'?'Execução interrompida':'Conectando'}</span>{p.nextAt&&<button className="textlink" onClick={onCycles}>{Date.parse(p.nextAt)<=Date.now()?'Janela disponível':'Próxima janela · '+date(p.nextAt)}<ArrowRight/></button>}</div>
    {p.error&&<details className="brain-pulse-error"><summary>Detalhes da falha</summary><p>{p.error}</p>{p.latest&&<button onClick={()=>onJob(p.latest.id)}>Ver execução</button>}</details>}
    {signals.length>0&&<div className="attention-signals" aria-label="Pendências com evidências">{signals.map((signal)=><div key={signal.id} className="brain-pulse-blocker">
      <WarningCircle size={22} aria-hidden="true"/><div><strong>{signal.title}</strong><p className="caption">{signal.reason}</p>
      <details><summary>{signal.target==='records'?signal.action:'Fontes e registros'}</summary>{signal.evidence.map(e=><button className="noterow" key={e.id} onClick={()=>openNote?.(e.path)}>{e.task||e.path}<ArrowRight/></button>)}</details></div>
      {signal.target!=='records'&&<button onClick={signal.target==='evolution'?(onReviewEvolution||onCycles):onLearnings}>{signal.action}<ArrowRight/></button>}
    </div>)}</div>}
    {p.available&&signals.length===0&&p.noNews&&<p className="caption">Os registros disponíveis não sustentam uma nova recomendação. As análises anteriores continuam no histórico.</p>}
    <details className="brain-pulse-evidence"><summary>Atividade e acervo · detalhes</summary>
    {p.inventory && <div className="brain-pulse-inventory" aria-label="Acervo conectado">
      <button onClick={onMemory}><strong>{number(p.inventory.notes)}</strong> notas<ArrowRight/></button>
      <button onClick={onSkills}><strong>{number(p.inventory.skills)}</strong> skills<ArrowRight/></button>
      <button onClick={onLearnings}><strong>{number(p.inventory.activeLearnings)}</strong> aprendizados ativos<ArrowRight/></button>
    </div>}
    {p.events.length>0&&<div className="brain-pulse-events" aria-label="Trabalho registrado">{p.events.map(e=><button className="brain-pulse-event" key={e.id} onClick={()=>e.target==='job'?onJob(e.jobId):onCycles()}>{e.warning?<WarningCircle size={20} aria-hidden="true"/>:<CheckCircle size={20} aria-hidden="true"/>}<span><strong>{e.title}</strong><small>{e.detail}</small></span><time dateTime={e.at}>{date(e.at)}</time><ArrowRight/></button>)}</div>}
    {p.available&&p.tasks>0&&<p className="brain-pulse-usage caption">Nos últimos 7 dias: {p.tasks} tarefas registradas · contexto usado em {p.contextUsed}, segundo os agentes.</p>}
    </details>
  </section>;
}
