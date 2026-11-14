import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {applicableCorrections} from '../backend/corrections.mjs';
const source='Actual source';
const row={kind:'correction',status:'active',id:'11111111-1111-4111-8111-111111111111',version:1,agent:'fixture',model:'fixture',sourcePath:'notes/source.md',sourceHash:createHash('sha256').update(source).digest('hex'),quote:'Actual',applicability:{intent:'task',matchTerms:['keepmind']},createdAt:'2026-11-14'};
const matches=(task,terms=['keepmind'])=>applicableCorrections([{...row,applicability:{...row.applicability,matchTerms:terms}}],task,'task',()=>source).length;
test('correction terms reject substrings and adjacent Unicode letters',()=>{
 for(const task of ['KeepMindless','superKeepMind','KeepMind中文','中文KeepMind','KeepMind𐐀','𐐀KeepMind'])expect(matches(task)).toBe(0);
});
test('correction terms preserve accents, punctuation, literal metacharacters and phrases',()=>{
 for(const task of ['KeepMind matching','KÉEPMIND matching','(KeepMind): matching'])expect(matches(task)).toBe(1);
 expect(matches('KeepMind C++ matching',['c++'])).toBe(1);
 expect(matches('KeepMind second brain matching',['second brain'])).toBe(1);
});
