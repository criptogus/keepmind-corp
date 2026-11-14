// Local lexical ranking; no embedding/model cost or external content transfer.
const tokens=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]{3,}/g)||[];
const stop=new Set(['para','como','com','uma','que','the','and','from','this','por','dos','das','nos','nas']);
export function retrieve(query,paths,read,{limit=6,budget=12000}={}) {
 const terms=[...new Set(tokens(query).filter(t=>!stop.has(t)))];
 if(!terms.length)return [];
 const docs=[];
 for(const path of [...new Set(paths)]){try{const body=read(path);const words=tokens(body);docs.push({path,body,words,counts:new Map(words.map(w=>[w,0]))});const d=docs.at(-1);for(const w of words)d.counts.set(w,d.counts.get(w)+1)}catch{}}
 const avg=docs.reduce((n,d)=>n+d.words.length,0)/Math.max(1,docs.length);
 const df=new Map(terms.map(t=>[t,docs.filter(d=>d.counts.has(t)).length]));
 for(const d of docs){d.score=terms.reduce((score,t)=>{const f=d.counts.get(t)||0;return score+(f?Math.log(1+(docs.length-df.get(t)+.5)/(df.get(t)+.5))*f*2.2/(f+1.2*(.25+.75*d.words.length/Math.max(1,avg))):0)+(tokens(d.path).includes(t)?2:0)},0)}
 let left=Math.min(24000,Math.max(500,budget));const out=[];
 for(const d of docs.filter(d=>d.score>0).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path))){if(out.length>=Math.min(10,limit)||left<100)break;
 const index=d.body.toLowerCase().indexOf(terms[0]);const start=Math.max(0,index-160);const excerpt=d.body.slice(start,start+Math.min(2400,left));left-=excerpt.length;out.push({path:d.path,score:Math.round(d.score*100)/100,excerpt,truncated:excerpt.length<d.body.length});}
 return out;
}
