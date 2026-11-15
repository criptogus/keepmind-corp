import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {readScopedSources} from '../backend/scoped-reads.mjs';
const job=()=>({paths:['notes/source.md','skills/procedure.md'],skillPath:'skills/procedure.md',reads:[],events:[]});
test('batch and single reads preserve complete Unicode sources and revision evidence',async()=>{
 const body='Fonte com ação e 𐐀.\n'.repeat(10000),j=job();
 const rows=await readScopedSources(j,[...j.paths,j.paths[0]],async()=>({body}));
 expect(rows).toHaveLength(2);expect(rows.every(r=>r.body===body)).toBe(true);
 expect(j.reads).toEqual(j.paths);expect(j.skillHash).toBe(createHash('sha256').update(body).digest('hex'));
 expect((await readScopedSources(j,[j.paths[0]],async()=>({body})))[0].body).toBe(body);
 expect(j.reads).toHaveLength(2);
});
test('denies unauthorized batch before any read, and never credits partial failure',async()=>{
 let calls=0;const j=job(),read=async()=>{calls++;return {body:'text'}};
 for(const paths of [[],null,['../secret.md'],[j.paths[0],'notes/other.md'],Array(12).fill(j.paths[0])])
  await expect(readScopedSources(j,paths,read)).rejects.toThrow();
 expect(calls).toBe(0);expect(j.reads).toEqual([]);
 await expect(readScopedSources(j,j.paths,async path=>{if(path===j.skillPath)throw Error('denied');return {body:'text'}})).rejects.toThrow();
 expect(j.reads).toEqual([]);expect(j.events).toEqual([]);expect(j.skillHash).toBeUndefined();
});
