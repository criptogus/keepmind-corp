import {test,expect} from 'bun:test';
import {quickProposal} from '../src/QuickProposal';
test('quick card surfaces concrete proposed action rather than generic title',()=>{
 const result={summary:'Fato: regras conflitantes. Hipótese: bloqueio. Proponho devolver ao coordenador com ponto de retomada.',skill:{name:'Encaminhar impedimentos'},learning:{body:'Definir responsabilidades.',purpose:'Evitar paralisação.'}};
 expect(quickProposal(result)).toEqual({action:'Proponho devolver ao coordenador com ponto de retomada.',why:'Evitar paralisação.'});
});
test('fallback uses the actual learning proposal without invented recommendations',()=>{
 expect(quickProposal({summary:'Relatório extenso.',learning:{body:'Conferir evidências.'}}).action).toBe('Conferir evidências.');
});
