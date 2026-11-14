import {test,expect} from 'bun:test';import {loadLiveData} from '../src/live-refresh.js';
function harness(){const state={error:''},cb={mounted:{current:true}};for(const key of ['Status','Today','Notes','Learnings','Skills','Jobs','Executions','SkillsError','SkillsLoaded','Error'])cb['set'+key]=v=>state[key.toLowerCase()]=v;return {state,cb}}
test('Hoje clears a recovered timeout only after the entire refresh succeeds',async()=>{
 const {state,cb}=harness();let fail=true;const api=async p=>{if(p==='/status')return {unlocked:true};if(p==='/today'&&fail)throw Error('Tempo limite do MCP');return p==='/today'?{available:true}:[]};
 await loadLiveData(api,cb);expect(state.error).toBe('Tempo limite do MCP');fail=false;await loadLiveData(api,cb);expect(state.error).toBe('');expect(state.today.available).toBe(true);
});
test('a healthy Today response must not hide a failing Skills refresh',async()=>{const {state,cb}=harness();await loadLiveData(async p=>{if(p==='/status')return {unlocked:true};if(p==='/skills')throw Error('Tempo limite do MCP');return []},cb);expect(state.error).toBe('Tempo limite do MCP');expect(state.skillserror).toBe(true)});
test('unmounted refresh does not change displayed error',async()=>{const {state,cb}=harness();state.error='existing';cb.mounted.current=false;await loadLiveData(async()=>({unlocked:true}),cb);expect(state.error).toBe('existing')});
