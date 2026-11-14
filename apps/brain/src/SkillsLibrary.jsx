import React,{useMemo,useState} from 'react';
import {api} from './live-api';
import {describeSkill,searchSkills} from './skill-catalog';
export default function SkillsLibrary({skills,available,loading,busy,openNote,launch,propose,act,refresh,children}){
 const [organizationError,setOrganizationError]=useState('');
 const [query,setQuery]=useState(''),[category,setCategory]=useState(''),[tag,setTag]=useState(''),[limit,setLimit]=useState(50),[organization,setOrganization]=useState({}),[reviewPath,setReviewPath]=useState(''),[review,setReview]=useState(null),[improve,setImprove]=useState(false);
 React.useEffect(()=>{api('/skills/organization').then(setOrganization).catch(()=>setOrganizationError('Não foi possível carregar sua organização. Reabra a tela para tentar novamente.'));},[]);
 const items=useMemo(()=>skills.map(s=>describeSkill(s,organization[s.path])),[skills,organization]);
 const filtered=searchSkills(items,query,category,tag);
 const categories=[...new Set(items.map(s=>s.category))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const tags=[...new Set(items.filter(s=>!category||s.category===category).flatMap(s=>s.tags))].sort();
 const selected=items.find(s=>s.path===reviewPath);
 const report=review?.report,actions=Array.isArray(report?.top_actions)?report.top_actions:[];
 const reset=()=>{setQuery('');setCategory('');setTag('');setLimit(50)};
 return <section className="panel skill-library">
 <div className="sectionhead"><h2>Skills</h2><button className="primary" onClick={()=>setImprove(!improve)} aria-expanded={improve}>Melhorar skills · SuperAgentSkill</button></div>
 {improve&&<section className="skill-improve" aria-label="Melhorar com SuperAgentSkill">
 <label className="field">Skill para melhorar<select disabled={busy} value={reviewPath} onChange={e=>{setReviewPath(e.target.value);setReview(null)}}><option value="">Selecione uma skill</option>{items.map(s=><option key={s.path} value={s.path}>{s.name} · {s.origin}</option>)}</select></label>
 <p className="caption">A avaliação envia somente o arquivo selecionado ao SuperAgentSkill. Retorna sugestões; a versão atual é preservada.</p>
 <button disabled={!selected||busy||!available} onClick={()=>act(async()=>{setReview(null);setReview(await api('/skills/review',{path:reviewPath,consent:true}))})}>Avaliar e sugerir melhorias</button>
 {review&&<div className="skill-review"><p role="status">Avaliação recebida · não é uma evolução comprovada pelo uso.</p>{typeof report==='object'&&<><p>Estrutura: {report.format_score??report.structural_score??'—'} · Conteúdo: {report.substance_score??report.substance?.score??'—'}</p><p>{report.substance?.rationale||report.rationale||report.text||''}</p>{actions.length>0&&<ul>{actions.slice(0,3).map((a,i)=><li key={i}>{typeof a==='string'?a:a.action||a.text||a.title||a.suggestion}</li>)}</ul>}</>}<details><summary>Parecer completo e evidências</summary><pre>{typeof review.report==='string'?review.report:JSON.stringify(review.report,null,2)}</pre></details>{selected?.metadata&&<button onClick={()=>propose(selected)}>Propor nova versão</button>}</div>}
 </section>}
 {organizationError&&<p role="alert">{organizationError}</p>}
 <div className="skill-filters">
 <label className="field">Buscar skills<input type="search" value={query} onChange={e=>{setQuery(e.target.value);setLimit(50)}} placeholder="Nome, tag, categoria ou conteúdo disponível"/></label>
 <label className="field">Categoria<select value={category} onChange={e=>{setCategory(e.target.value);setTag('');setLimit(50)}}><option value="">Todas ({items.length})</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
 <label className="field">Tag<select value={tag} onChange={e=>{setTag(e.target.value);setLimit(50)}}><option value="">Todas</option>{tags.map(t=><option key={t}>{t}</option>)}</select></label>
 </div>
 <div className="sectionhead"><p role="status">{available?`${filtered.length} de ${skills.length} skills`:loading?'Carregando skills…':'Skills indisponíveis'}</p>{(query||category||tag)&&<button onClick={reset}>Limpar filtros</button>}</div>
 {children}
 {loading?<p role="status">Consultando o acervo real…</p>:!available?<p>Não foi possível consultar as skills. <button onClick={()=>act(refresh)}>Tentar novamente</button></p>:filtered.slice(0,limit).map(s=><details key={s.path} className="routinecard skill-row">
 <summary>{s.name}<small> · {s.category} · {s.origin}{s.metadata?.version?` · v${s.metadata.version}`:''}</small></summary>
 {s.description&&<p>{s.description}</p>}
 <div className="skill-tags">{s.tags.map(t=><button key={t} onClick={()=>{setTag(t);setLimit(50)}}>#{t}</button>)}</div>
 <p className="caption">{s.path}{s.categoryInferred?' · Categoria pela pasta':''}{s.tagsInferred?' · Tag pela pasta':''}</p>
 <details className="skill-organize"><summary>Organizar</summary><p className="caption">Organização local do KeepMind; o arquivo original é preservado.</p><form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);act(async()=>{const next=await api('/skills/organization',{path:s.path,category:data.get('category'),tags:String(data.get('tags')).split(',')});setOrganization(next);setCategory('');setTag('');})}}>
 <label className="field">Categoria<input name="category" defaultValue={s.category} maxLength={60} list="skill-categories"/></label>
 <label className="field">Tags, separadas por vírgula<input name="tags" defaultValue={s.tags.join(', ')} maxLength={400}/></label>
 <button disabled={busy||!!organizationError}>Salvar organização</button></form></details>
 {s.metadata?.steps&&<ol>{s.metadata.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>}
 <div className="actions"><button onClick={()=>openNote(s.path)}>Ver arquivo real</button><button disabled={busy} onClick={()=>launch(s)}>Executar com Codex</button><button disabled={busy} onClick={()=>{setReviewPath(s.path);setReview(null);setImprove(true);document.querySelector('.skill-improve')?.scrollIntoView({block:'center'})}}>Melhorar com SuperAgentSkill</button>{s.metadata&&<button onClick={()=>propose(s)}>Propor nova versão</button>}</div>
 </details>)}
 <datalist id="skill-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
 {available&&!filtered.length&&<p>{items.length?'Nenhuma skill encontrada. Ajuste os filtros ou limpe a busca.':'Nenhuma skill no acervo conectado.'}</p>}
 {filtered.length>limit&&<button onClick={()=>setLimit(n=>n+50)}>Mostrar mais ({filtered.length-limit})</button>}
 </section>
}
