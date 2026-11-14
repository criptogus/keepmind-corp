import {test,expect} from 'bun:test';
import {attentionSignals} from '../src/attention-signals';
test('counts alone and incomplete error references never become recommendations',()=>{
 expect(attentionSignals({available:true,inventory:{notes:8000,skills:400},value:{recurringErrors:[{key:'timeout',ids:['a','a','missing']}],records:[{id:'a',outcome:'failure',path:'a.md'}]}})).toEqual([]);
});
test('recurring failure requires two distinct failed tasks with source records',()=>{
 const t={available:true,value:{recurringErrors:[{key:'timeout',ids:['a','b','a']}],records:[{id:'a',outcome:'failure',path:'a.md'},{id:'b',outcome:'failure',path:'b.md'}]}};
 const [s]=attentionSignals(t);expect(s.evidence).toHaveLength(2);expect(s.title).toContain('timeout');expect(s.reason).toContain('Relatado');
 t.value.records[1].outcome='success';expect(attentionSignals(t)).toEqual([]);
});
test('a newer successful trial prevents resurfacing an older blocked trial for the same skill',()=>{
 const trials=[{id:'old',path:'skills/a.md',status:'failed',createdAt:'2026-11-13'},{id:'new',path:'skills/a.md',status:'promoted',createdAt:'2026-11-14'}];
 expect(attentionSignals({available:true,cycles:{trials}})).toEqual([]);
 expect(attentionSignals({available:true,cycles:{trials:[...trials].reverse()}})).toEqual([]);
});
test('names actual blocked skills, distinguishes reasons, and requires a source for suspended knowledge',()=>{
 const signals=attentionSignals({available:true,cycles:{trials:[{id:'x',path:'skills/a.md',name:'Revisão de código',status:'needs-suite'}]}},[{id:'learning',status:'suspended',sourcePath:'notes/API.md'},{id:'private',status:'suspended'}]);
 expect(signals).toHaveLength(2);expect(signals[0].title).toContain('API.md');expect(signals[1].title).toContain('Revisão de código');expect(signals[1].reason).toContain('teste específico');
 expect(attentionSignals({available:false,cycles:{trials:[]}})).toEqual([]);
});
