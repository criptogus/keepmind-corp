// One owner, one real-vault adapter. Cleanup is an index operation, never deletion.
import {createHash} from 'node:crypto';
export const sha=s=>createHash('sha256').update(s).digest('hex');
export async function inspectMemory({list,read,learnings,archive,now=Date.now()}) {
  const paths=await list(), groups=new Map(), failures=[];let inspected=0;
  for(const path of paths){try{const body=await read(path);inspected++;const key=sha(body);const group=groups.get(key)||[];group.push(path);groups.set(key,group)}catch{failures.push(path)}}
  let duplicates=0,archived=0;
  for(const [hash,group] of groups){if(group.length<2)continue;group.sort((a,b)=>Number(/^(notes|long-term)\//.test(a))-Number(/^(notes|long-term)\//.test(b))||a.localeCompare(b));duplicates+=group.length-1;
    for(const path of group.slice(1)){// Only generated reports may leave the active index; originals and skills stay untouched.
      if(/^long-term\/maintenance\//.test(path)) {await archive({path,hash,canonical:group[0]});archived++}
    }
  }
  const learning=await learnings();
  return {at:new Date(now).toISOString(),inspected,duplicates,archived,failures,learning:{active:learning.filter(l=>l.status==='active').length,suspended:learning.filter(l=>l.status==='suspended').length},cleanup:'soft-archive; content and direct MCP reads retained'};
}
