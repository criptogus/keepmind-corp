import {test,expect} from 'bun:test';
import {contextPack,contextDrift} from '../backend/context-pack.mjs';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const docs={
 'Atlas/decision.md':'---\ntype: decision\nstatus: active\n---\nIntegration MCP: require a literal source.',
 'Atlas/duplicate.md':'---\ntype: decision\nstatus: active\n---\nIntegration MCP: require a literal source.',
 'Atlas/retired.md':'---\nstatus: superseded\n---\nIntegration MCP old procedure',
 'Atlas/draft.md':'---\nstatus: draft\ntype: reference\n---\nIntegration MCP experimental proposal',
 'Other/memo.md':'Integration MCP other client context',
 'Atlas/log.md':'Reported error: missing source.'
};
const read=p=>{if(!(p in docs))throw Error('denied');return docs[p]};
test('project scope, deduplication, roles and retirement preserve sources and context budget',()=>{
 const p=contextPack('Integration MCP',Object.keys(docs),read,{project:'Atlas',budget:500});
 expect(p.sources.every(s=>s.path.startsWith('Atlas/'))).toBe(true);expect(p.excluded.duplicates).toBe(1);expect(p.excluded.retired).toBe(1);expect(p.sources.some(s=>s.role==='decision')).toBe(true);expect(p.sources.some(s=>s.status==='draft'&&s.role==='reference')).toBe(true);expect(p.characters).toBeLessThanOrEqual(500);expect(()=>contextPack('MCP',Object.keys(docs),read,{project:'../Other'})).toThrow();expect(docs['Atlas/retired.md']).toContain('superseded');
});
test('cautions need repeated distinct tasks, exact used revision and current evidence',()=>{
 const row={id:'a',at:new Date().toISOString(),outcome:'failure',errorKey:'missing-source',used:[{path:'Atlas/decision.md',hash:hash(docs['Atlas/decision.md']),unchanged:true}],evidence:{path:'Atlas/log.md',hash:hash(docs['Atlas/log.md'])}};
 const pack=usage=>contextPack('Integration MCP',Object.keys(docs),read,{project:'Atlas',usage});
 expect(pack([row,row]).cautions).toHaveLength(0);expect(pack([row,{...row,id:'b'}]).cautions).toHaveLength(1);
 expect(pack([row,{...row,id:'b',evidence:{...row.evidence,hash:'stale'}}]).cautions).toHaveLength(0);
 expect(pack([row,{...row,id:'b',used:[{...row.used[0],hash:'old'}]}]).cautions).toHaveLength(0);
});
test('source drift detects changed and unavailable content without mutating receipt',()=>{
 const sources=[{path:'Atlas/decision.md',hash:hash(docs['Atlas/decision.md'])},{path:'missing.md',hash:'old'}];
 expect(contextDrift(sources,read).map(s=>s.status)).toEqual(['current','unavailable']);
 expect(contextDrift(sources,()=> 'updated')[0].status).toBe('changed');expect(sources[0].hash).toBe(hash(docs['Atlas/decision.md']));
});
test('handoff includes complete short evidence and verbatim late paragraphs with honest gaps',()=>{
 const body='Introduction unrelated.\n\n'+('Filler without matching words.\n\n'.repeat(300))+'Integration result: no productivity gain was proved.';
 const d={'notes/runbook.md':'---\ntype: operational-reference\n---\nIntegration: reconnect the MCP client.','long-term/maintenance/review.md':body};
 const p=contextPack('handoff integration productivity',Object.keys(d),x=>d[x],{budget:2000});
 expect(p.intent).toBe('handoff');expect(p.sources[0].complete).toBe(true);const evidence=p.sources.find(s=>s.role==='evaluation-evidence');expect(evidence.excerpt).toContain('no productivity gain');expect(evidence.complete).toBe(false);for(const span of evidence.spans)expect(body.slice(span.start,span.end).length).toBeGreaterThan(0);expect(p.characters).toBeLessThanOrEqual(2000);
});
