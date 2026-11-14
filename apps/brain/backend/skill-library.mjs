export function organizationEntry(input){
 if(typeof input.category!=='string'||input.category.trim().length>60||!Array.isArray(input.tags)||input.tags.length>20||input.tags.some(t=>typeof t!=='string'||t.trim().length>40))throw Error('Use uma categoria de até 60 caracteres e até 20 tags de 40 caracteres.');
 return {category:input.category.trim(),tags:[...new Set(input.tags.map(t=>t.trim().replace(/^#/, '')).filter(Boolean))]};
}
export function reviewContent(body){
 if(typeof body!=='string'||body.trim().length<20)throw Error('A skill precisa ter pelo menos 20 caracteres.');
 if(body.length>120000)throw Error('A skill excede o limite de 120.000 caracteres do SuperAgentSkill. Nenhum conteúdo foi enviado.');
 if(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})|(?:api[_-]?key|password|senha|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_\-+/]{16,}/i.test(body))throw Error('Possível credencial na skill. Remova-a antes de enviar ao SuperAgentSkill.');
 return body;
}
export function parseMcpResponse(text){
 const candidates=text.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim());
 if(!candidates.length)candidates.push(text);
 for(const candidate of candidates){
  let j;try{j=JSON.parse(candidate)}catch{continue}
  if(j.error)throw Error('SuperAgentSkill: '+(j.error.message||'avaliação recusada'));
  if(!j.result)continue;
  if(j.result.isError)throw Error('O SuperAgentSkill não concluiu a avaliação.');
  if(j.result.structuredContent)return j.result.structuredContent;
  const txt=j.result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  if(txt){try{return JSON.parse(txt)}catch{return txt}}
 }
 throw Error('O SuperAgentSkill não retornou um parecer válido.');
}
export async function reviewWithSuperAgentSkill({name,body},fetcher=fetch){
 const content=reviewContent(body);
 const response=await fetcher('https://superagentskill.com/api/public/mcp',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
  headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'review_skill',arguments:{name:name.slice(0,200),content,type:'skill',language:'pt',semantic_check:true}}})
 });
 if(!response.ok)throw Error(`SuperAgentSkill indisponível (${response.status}). Tente novamente.`);
 return parseMcpResponse(await response.text());
}
