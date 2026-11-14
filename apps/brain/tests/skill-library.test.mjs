import {test,expect} from 'bun:test';
import {describeSkill,searchSkills} from '../src/skill-catalog.js';
import {organizationEntry,reviewContent,reviewWithSuperAgentSkill,parseMcpResponse} from '../backend/skill-library.mjs';
test('search combines accent-insensitive terms, tags and categories, with title ranking',()=>{
 const a=describeSkill({path:'skills/a.md',title:'Automação',body:'fluxo vendas'},{category:'Negócios',tags:['revisão']});
 const b=describeSkill({path:'skills/b.md',title:'Vendas',body:'automação'});
 expect(searchSkills([b,a],'automacao')[0].name).toBe('Automação');
 expect(searchSkills([a,b],'automacao revisao','Negócios','revisão')).toEqual([a]);
 expect(searchSkills([a],'inexistente')).toEqual([]);
});
test('folder classification is marked inferred; explicit metadata and custom tags take precedence',()=>{
 const s={path:'_hermes-skills/media/video/SKILL.md',title:'video'};
 expect(describeSkill(s).category).toBe('Mídia');
 expect(describeSkill(s).categoryInferred).toBe(true);
 expect(describeSkill(s,{category:'Criação',tags:['video','video']}).tags).toEqual(['video']);
 expect(describeSkill(s,{category:'Criação'}).categoryInferred).toBe(false);
});
test('organization validates bounds and preserves intentional empty tags',()=>{
 expect(organizationEntry({category:' X ',tags:['#tag','tag','']})).toEqual({category:'X',tags:['tag']});
 expect(()=>organizationEntry({category:'x',tags:['x'.repeat(41)]})).toThrow();
});
test('review never truncates or sends recognized credentials',()=>{
 expect(()=>reviewContent('x'.repeat(120001))).toThrow();
 expect(()=>reviewContent('api_key=sk-'+'a'.repeat(40))).toThrow();
});
test('MCP errors are not displayed as successful reviews',()=>{
 expect(()=>parseMcpResponse('{"error":{"message":"denied"}}')).toThrow();
 expect(()=>parseMcpResponse('{"result":{"isError":true,"content":[]}}')).toThrow();
 expect(parseMcpResponse('data: {"result":{"content":[{"type":"text","text":"{\\"score\\":70}"}]}}'.replaceAll('\\','\\'))).toEqual({score:70});
});
test('review sends only exact selected skill, never usage logs or credentials',async()=>{
 let payload;
 const result=await reviewWithSuperAgentSkill({name:'Fixture',body:'# Fixture\nOnly test content.'},async(url,opts)=>{
  expect(url).toBe('https://superagentskill.com/api/public/mcp');payload=JSON.parse(opts.body);
  return {ok:true,text:async()=>JSON.stringify({result:{structuredContent:{overall_score:70}}})};
 });
 expect(payload.params.arguments.content).toBe('# Fixture\nOnly test content.');
 expect(Object.keys(payload.params.arguments).sort()).toEqual(['content','language','name','semantic_check','type']);
 expect(result.overall_score).toBe(70);
});
