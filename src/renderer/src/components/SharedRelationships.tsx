import { useEffect, useState } from 'react'

type Contact = { id:string; path:string; name:string; kind:string }
type Props = { contacts:Contact[]; loading:boolean; error:string; onRefresh:()=>void; onOpenSource?:(path:string)=>void; onAsk?:(text:string)=>void; initialContactId?:string; initialRequest?:number }
export default function SharedRelationships({contacts, loading, error, onRefresh, onOpenSource, onAsk, initialContactId, initialRequest}:Props) {
  const [kind,setKind] = useState('person')
  const [query,setQuery] = useState('')
  const [selected,setSelected] = useState(initialContactId ?? '')
  const [detail,setDetail] = useState<any>(null)
  const [failure,setFailure] = useState('')
  const [pending,setPending] = useState(false)
  const [retry,setRetry] = useState(0)
  useEffect(()=>{ if(initialContactId) { setSelected(initialContactId); setKind(initialContactId.startsWith('Companies/')?'company':'person') } },[initialContactId,initialRequest])
  useEffect(()=>{
    let live = true
    setDetail(null); setFailure('')
    if(!selected) { setPending(false); return }
    setPending(true)
    window.sb.crm('profile',{path:selected}).then(result=>{if(live) setDetail(result)}).catch(e=>{if(live) setFailure(String(e.message ?? e))}).finally(()=>{if(live) setPending(false)})
    return ()=>{live=false}
  },[selected,retry,contacts])
  const normalize = (s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase()
  const filtered=contacts.filter(c=>c.kind===kind && normalize(c.name+' '+c.path).includes(normalize(query)))
  return <div className="view relationships">
    <div className="crm-head"><div><div className="hud-tag">RELACIONAMENTOS</div><h1>Pessoas e empresas</h1><p className="crm-muted">Perfis e registros do seu second brain.</p></div><button className="btn btn--ghost btn--sm" disabled={loading} onClick={onRefresh}>Atualizar</button></div>
    {error && <p role="alert">{error}</p>}
    <div className="crm-tabs" aria-label="Tipos de perfil">{[['person','Pessoas'],['company','Empresas']].map(([value,label])=><button key={value} className="crm-tab" aria-pressed={kind===value} onClick={()=>{setKind(value);setSelected('')}}>{label} · {contacts.filter(c=>c.kind===value).length}</button>)}</div>
    <div className="crm-grid"><section className="crm-stack"><label>Buscar perfil<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nome da pessoa ou empresa"/></label><small className="crm-muted">Perfis disponíveis via MCP</small><div className="crm-list crm-profile-list" aria-busy={loading}>{filtered.map(c=><button className="crm-item" key={c.id} aria-current={selected===c.path} onClick={()=>setSelected(c.path)}><strong>{c.name}</strong></button>)}{!filtered.length && <p role="status">{loading?'Consultando memória…':'Nenhum perfil encontrado.'}</p>}</div></section>
    <section className="crm-stack" aria-busy={pending}>{pending && <p role="status">Consultando perfil…</p>}{failure && <div role="alert"><p>{failure}</p><button className="btn btn--ghost" onClick={()=>setRetry(x=>x+1)}>Tentar novamente</button></div>}
      {!selected && <p className="crm-muted">Selecione um perfil para ver o contexto e os registros vinculados.</p>}
      {detail && <><article className="card crm-card"><h2>{detail.name}</h2><div className="crm-actions">{!detail.ownerOnly && <button className="btn btn--ghost btn--sm" onClick={()=>onOpenSource?.(detail.path)}>Abrir perfil original</button>}{!detail.ownerOnly && <button className="btn btn--ghost btn--sm" onClick={()=>onAsk?.(`Consulte o perfil ${detail.path} e seus registros vinculados no second brain. Resuma o relacionamento e cite as fontes, sem inventar informações.`)}>Conversar sobre este perfil</button>}</div>{detail.ownerOnly && <small className="crm-muted">Confidencial · visível apenas nesta consulta local</small>}<div className="crm-body crm-profile-body">{detail.body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')}</div></article>
      <section className="card crm-card"><h3>Conversas e fontes vinculadas</h3><div className="crm-list">{detail.sources.map((source:any)=><button key={source.path} className="crm-item" onClick={()=>source.kind==='profile'?setSelected(source.path):onOpenSource?.(source.path)}><strong>{source.title}</strong><small>{source.kind==='profile'?'Perfil relacionado':'Abrir registro original'}</small></button>)}</div>{!detail.sources.length && <p className="crm-muted">Este perfil não tem fontes vinculadas disponíveis no MCP.</p>}{detail.unavailable>0 && <p className="crm-muted">{detail.unavailable} vínculo(s) não resolvido(s) ou indisponível(is) no MCP.</p>}</section></>}
    </section></div>
  </div>
}
