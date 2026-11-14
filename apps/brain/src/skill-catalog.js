export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const labels={development:'Desenvolvimento',coding:'Desenvolvimento',devops:'Desenvolvimento',marketing:'Marketing',research:'Pesquisa',media:'Mídia',productivity:'Produtividade',automation:'Automação',security:'Segurança',data:'Dados',business:'Negócios', 'knowledge-management':'Conhecimento', 'software-development':'Desenvolvimento', github:'Desenvolvimento', hermes:'Agentes e IA', 'autonomous-ai-agents':'Agentes e IA', intelligence:'Agentes e IA', mcp:'Agentes e IA', mlops:'Agentes e IA', 'game-dev':'Jogos', creative:'Criação e design', design:'Criação e design', 'content-production':'Conteúdo', 'thought-leadership':'Conteúdo', 'marketing-skills':'Marketing', 'social-media':'Marketing', 'business-consulting':'Negócios', 'business-intelligence':'Negócios', 'investment-analysis':'Finanças', finance:'Finanças', 'wealth-building':'Finanças', 'note-taking':'Conhecimento', 'pm-execution':'Produto', 'pm-product-strategy':'Produto', 'pm-market-research':'Produto', 'pm-product-discovery':'Produto', 'red-teaming':'Segurança', operations:'Produtividade', email:'Produtividade', apple:'Produtividade', system:'Produtividade', health:'Vida pessoal', travel:'Vida pessoal', alquimia:'Desenvolvimento pessoal'};
export function describeSkill(s,custom={}){
 const fm=s.body?.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]||'';
 const field=k=>fm.match(new RegExp('^'+k+':\\s*(.+)$','m'))?.[1]?.replace(/^["']|["']$/g,'').trim();
 const origin=s.path.startsWith('_hermes-skills/')?'Hermes':s.metadata?'KeepMind':'Acervo';
 const folder=s.path.startsWith('_hermes-skills/')&&s.path.split('/').length>3?s.path.split('/')[1]:null;
 const category=custom.category||s.metadata?.category||field('category')||labels[folder]||'Sem categoria';
 const rawTags=s.metadata?.tags||field('tags')||(folder?[folder]:[]);
 const tags=custom.tags??(Array.isArray(rawTags)?rawTags:String(rawTags).replace(/[\[\]"']/g,'').split(','));
 return {...s,name:s.metadata?.name||field('name')||s.title||s.path,description:s.metadata?.purpose||field('description')||'',category,tags:[...new Set(tags.map(t=>String(t).trim()).filter(Boolean))],origin,tagsInferred:custom.tags===undefined&&!s.metadata?.tags&&!field('tags')&&!!folder,categoryInferred:!custom.category&&!s.metadata?.category&&!field('category')&&!!folder};
}
export function searchSkills(items,query='',category='',tag=''){
 const terms=normalize(query).trim().split(/\s+/).filter(Boolean);
 return items.filter(s=>(!category||s.category===category)&&(!tag||s.tags.includes(tag))).map(s=>{
 const name=normalize(s.name),meta=normalize([s.category,...s.tags,s.description,s.origin,s.path].join(' ')),body=normalize(s.body);
 if(!terms.every(t=>name.includes(t)||meta.includes(t)||body.includes(t)))return null;
 return {s,score:terms.reduce((n,t)=>n+(name===t?10:name.startsWith(t)?6:name.includes(t)?4:meta.includes(t)?2:1),0)};
 }).filter(Boolean).sort((a,b)=>b.score-a.score||a.s.name.localeCompare(b.s.name,'pt-BR')).map(x=>x.s);
}
