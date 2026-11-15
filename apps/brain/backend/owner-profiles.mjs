import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
// Separate owner-only projection. Never used by sb_read, context, search or jobs.
export function ownerProfiles(root,enabled){
 const valid=p=>typeof p==='string'&&/^(People|Companies)\/(?:[^/]+\/)*[^/]+\.md$/.test(p)&&!p.split('/').some(x=>x.startsWith('.')||/secret|credential|quarantine/i.test(x))&&!p.includes('\\');
 function read(path){
  if(!enabled)throw Error('Owner profile access not enabled');
  if(!valid(path))throw Error('Profile path denied');
  const file=resolve(root,path);if(!file.startsWith(root+sep))throw Error('Profile path denied');
  let part=root;for(const segment of path.split('/')){part=join(part,segment);if(lstatSync(part).isSymbolicLink())throw Error('Symlink denied');}
  const body=readFileSync(file,'utf8');
  if(body.startsWith('KEEPMIND-')||/^(?:class|classification|confidentiality):\s*["']?(?:secret|sensitive|restricted)/mi.test(body)||/\b(?:gh[o,p,s,u,r]_[A-Za-z0-9]{12,}|github_pat_[\w]+|sk-[\w-]{16,}|xox[baprs]-[\w-]+)|-----BEGIN .*PRIVATE KEY-----/.test(body))throw Error('Profile outside owner scope');
  return body;
 }
 function list(){
  if(!enabled)throw Error('Owner profile access not enabled');
  const paths=[];function walk(prefix){let entries;try{entries=readdirSync(join(root,prefix),{withFileTypes:true})}catch{return}for(const e of entries){const path=prefix+'/'+e.name;if(e.isSymbolicLink()||e.name.startsWith('.'))continue;if(e.isDirectory())walk(path);else if(valid(path)){try{read(path);paths.push(path)}catch{}}}}
  for(const folder of ['People','Companies']){try{if(!lstatSync(join(root,folder)).isSymbolicLink())walk(folder)}catch{}}
  return paths;
 }
 return {read,list};
}
