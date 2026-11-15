import {test,expect} from 'bun:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {todayPulse} from '../src/today-pulse';
import TodayPulse from '../src/TodayPulse';
const today={available:true,inventory:{notes:42,skills:3,activeLearnings:1},autonomy:{enabled:true,status:'done',jobId:'real-job',noNews:true,nextAt:new Date(Date.now()+86400000).toISOString()},value:{tasks:2,contextUsed:1},cycles:{maintenance:{at:'2026-11-14T10:00:00Z',inspected:45,archived:0},trials:[{id:'trial',path:'skills/test.md',status:'needs-usage-evidence',name:'Test skill'}]}};
const jobs=[{id:'real-job',status:'done',reads:['a','a','b'],finishedAt:'2026-11-14T11:00:00Z'}];
test('no proposals still shows useful recorded work, actual inventory, next quota and blocked evolution',()=>{
 const p=todayPulse(today,jobs,true);
 expect(p.mode).toBe('ready');expect(p.events[0].detail).toBe('2 fontes consultadas');expect(p.blockers).toHaveLength(1);
 const html=renderToStaticMarkup(<TodayPulse today={today} jobs={jobs} connected/>);
 for(const value of ['42','Última análise concluída','45 arquivos','Próxima janela','Ver validação'])expect(html).toContain(value);
 expect(html).not.toContain('Nada novo para revisar');expect(html).not.toContain('ganho comprovado');
});
test('a lost connection cannot turn old counts into a healthy live signal',()=>{
 const p=todayPulse(today,jobs,true,'Timeout');expect(p.mode).toBe('unavailable');expect(p.inventory).toBeNull();expect(p.events).toEqual([]);expect(p.blockers).toEqual([]);expect(p.nextAt).toBeNull();
});
test('idle is not presented as active analysis, paused has no next execution promise',()=>{
 expect(todayPulse(today,jobs,true).mode).not.toBe('running');
 const p=todayPulse({...today,autonomy:{...today.autonomy,enabled:false}},jobs,true);expect(p.mode).toBe('paused');expect(p.nextAt).toBeNull();
 expect(todayPulse({...today,autonomy:{...today.autonomy,status:'running'}},jobs,true).mode).toBe('running');
});
test('loading and missing evidence produce no invented activity',()=>{
 const p=todayPulse(null,[],false);expect(p.inventory).toBeNull();expect(p.events).toEqual([]);expect(p.title).toBe('Conectando à sua memória');
 expect(todayPulse({...today,cycles:{},autonomy:{enabled:true}},[],true).events).toEqual([]);
});
