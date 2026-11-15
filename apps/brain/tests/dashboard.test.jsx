import {test,expect} from 'bun:test';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {buildDashboard} from '../backend/dashboard.mjs';
import TodayDashboard from '../src/TodayDashboard';
const now=new Date(2026,10,14,12).getTime(),day=86400000;
const row=(id,ago,extra={})=>({id,at:new Date(now-ago*day).toISOString(),agent:'Codex',mode:'keepmind',task:'Task '+id,receiptPath:id+'.md',used:[],...extra});
const metric=(d,period,id)=>d.windows[period].groups.flatMap(g=>g.metrics).find(m=>m.id===id);
test('Today, 7d and 30d use timestamps and exclude future, baseline and duplicate receipts',()=>{
 const a=row('a',0),d=buildDashboard({now,available:true,shared:true,usage:[a,a,row('b',3),row('c',20),row('old',31),row('future',-1),row('baseline',0,{mode:'github'})]});
 expect(metric(d,'today','tasks').value).toBe(1);expect(metric(d,'7d','tasks').value).toBe(2);expect(metric(d,'30d','tasks').value).toBe(3);expect(d.windows.today.timeline).toHaveLength(1);
});
test('reported context and cross-agent correction usage require matching unchanged evidence',()=>{
 const learnings=[{id:'fix',kind:'correction',agent:'Codex',createdAt:new Date(now).toISOString()}];
 const usage=[row('a',0,{used:[{path:'learnings/fix.md',unchanged:true}]}),row('b',0,{agent:'Devin',used:[{path:'learnings/fix.md',unchanged:true}]}),row('c',0,{agent:'Claude',used:[{path:'learnings/fix.md',unchanged:false}]})];
 const d=buildDashboard({now,available:true,shared:true,usage,learnings});expect(metric(d,'today','contexts').value).toBe(2);expect(metric(d,'today','cross-agent').value).toBe(1);expect(d.windows.today.gain.value).toBeNull();expect(metric(d,'today','queries').value).toBeNull();
});
test('staged, undone and unverified changes cannot count as updated files',()=>{
 const executions=['done','staged','undone'].map((status,i)=>({id:String(i),status,finishedAt:new Date(now).toISOString(),changes:[{path:status+'.md',applied:true,verified:true}]}));
 executions.push({id:'unsafe',status:'done',finishedAt:new Date(now).toISOString(),changes:[{path:'bad.md',applied:true}]});
 const d=buildDashboard({now,available:true,executions});expect(metric(d,'today','updated').value).toBe(1);
});
test('promotion requires completed comparable evidence; maintenance is not extrapolated',()=>{
 const e={model:'same-model',suiteHash:'same-suite',total:1,cases:[{id:'one',pass:true}],score:1,finishedAt:new Date(now).toISOString()};
 const valid={id:'v',status:'promoted',promotedAt:new Date(now).toISOString(),runs:{baseline:{evidence:{...e,score:0,cases:[{id:'one',pass:false}]}},candidate:{evidence:e}}};
 const d=buildDashboard({now,available:true,cycles:{trials:[valid,{id:'fake',status:'promoted',promotedAt:new Date(now).toISOString()}],maintenance:{at:new Date(now-3*day).toISOString(),archived:2}}});
 expect(metric(d,'today','tested').value).toBe(1);expect(metric(d,'today','promoted').value).toBe(1);expect(metric(d,'today','archived').value).toBeNull();expect(metric(d,'30d','archived').value).toBe(2);
});
test('offline cannot masquerade as zero activity or no pending decisions',()=>{
 const dashboard=buildDashboard({now,available:true,shared:true,usage:[row('a',0)]});
 const html=renderToStaticMarkup(<TodayDashboard today={{dashboard}} connected={false}/>);
 expect(html).toContain('Pendências indisponíveis');expect(html).not.toContain('Nenhuma aprovação pendente');expect(html).not.toContain('Task a');
 expect(metric(buildDashboard({now,available:false}),'today','tasks').value).toBeNull();
});
