import {test,expect} from 'bun:test';
import {selectSources,due,usefulInsight} from '../backend/autonomy.mjs';
test('selection bounds scope, diversifies folders and avoids skills and journals',()=>{const notes=Array.from({length:20},(_,i)=>({path:`project-${i%5}/note-${i}.md`,kind:'Nota'}));notes.push({path:'skills/SKILL.md',kind:'Skill'},{path:'Journal/private.md',kind:'Nota'},{path:'_hermes-skills/project/references/review.md',kind:'Nota'});const selected=selectSources(notes);expect(selected.length).toBe(6);expect(selected.some(p=>/skills|Journal/.test(p))).toBe(false);expect(new Set(selected.map(p=>p.split('/')[0])).size).toBeGreaterThanOrEqual(3);expect(notes.some(n=>n._selected)).toBe(false);expect(selectSources(notes,selected)).not.toEqual(selected)});
test('daily budget survives reload and never overlaps other runs',()=>{const config={enabled:true,lastAttempt:100};expect(due(config,[],86400100)).toBe(true);expect(due(config,[],1000)).toBe(false);expect(due(config,[{status:'running'}],86400100)).toBe(false);expect(due({...config,enabled:false},[],86400100)).toBe(false)});

test('restart budget also uses persisted jobs',()=>{expect(due({enabled:true,lastAttempt:0},[{autonomous:true,status:'done',startedAt:new Date(10000).toISOString()}],20000)).toBe(false)});
test('feed suppresses duplicates, missing evidence, no-news and stale results',()=>{
 const j={status:'done',finishedAt:new Date().toISOString(),reads:['notes/a.md'],result:{decision:{ready:true,target:'Integração MCP do projeto Atlas',change:'Exigir evidência por integração',benefit:'Evitar declarações incorretas de funcionamento',evidence:'Revisão registrada identificou conclusão sem fonte',evidencePath:'notes/a.md'},summary:'Conectar decisões de arquitetura aos resultados dos experimentos reduz retrabalho no projeto.',sourcePaths:['notes/a.md'],skill:{steps:['Revisar evidências']}}};
 expect(usefulInsight(j)).toBe(true);expect(usefulInsight(j,[j])).toBe(false);
 expect(usefulInsight({...j,reads:[]})).toBe(false);
 expect(usefulInsight({...j,result:{...j.result,summary:'SEM_NOVIDADE: sem evidência'}})).toBe(false);
 expect(usefulInsight({...j,finishedAt:'2020-01-01'})).toBe(false);
});
