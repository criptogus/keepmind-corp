import {test,expect} from 'bun:test';
import {createTask,makeLearning,makeRoutine,resultText,defaultProfile} from '../src/workflow.js';
const notes=[{id:'a',title:'A',body:'Original',type:'Nota'},{id:'b',title:'B',body:'Outro',type:'Nota'}];
test('resultado preserva a versão da fonte mesmo após edição',()=>{const ns=structuredClone(notes);const t=createTask('Revisar',ns,defaultProfile);ns[0].body='Alterado';expect(resultText(t)).toContain('Original');expect(resultText(t)).not.toContain('Alterado')});
test('seleção explícita limita as fontes e permite detectar ausência',()=>{expect(createTask('Revisar',notes,defaultProfile,true,['b']).sources.map(n=>n.id)).toEqual(['b']);expect(createTask('Revisar',notes,defaultProfile,true,[]).sources).toHaveLength(0)});
test('modo manual não inicia sozinho',()=>expect(createTask('Revisar',notes,defaultProfile,false).status).toBe('planned'));
test('aprendizado carrega escopo, origem, snapshot e revisão',()=>{const t=createTask('Revisar',notes,defaultProfile);const n=makeLearning(t);expect(n.provenance.taskId).toBe(t.id);expect(n.provenance.sources[0].excerpt).toBe('Original');expect(n.provenance.reviewedAt).toBeTruthy();expect(n.type).toBe('Aprendizado')});
test('rotina incorpora aprendizado aprovado e mantém limites',()=>{const t={...createTask('Revisar',notes,defaultProfile),learningState:'applied',executor:'Claude Code'};const r=makeRoutine(t,'Revisão','Semanal');expect(r.sourceIds).toContain('learning-'+t.id);expect(r.executor).toBe('Claude Code');expect(r.version).toBe(1);expect(r.limits).toContain('Sem gastos')});
test('proposta descartada não vira fonte da rotina',()=>{const t={...createTask('Revisar',notes,defaultProfile),learningState:'discarded'};expect(makeRoutine(t,'Revisão','Manual').sourceIds).toEqual(['a','b'])});
