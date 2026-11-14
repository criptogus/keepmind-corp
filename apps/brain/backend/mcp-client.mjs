import { spawn } from 'node:child_process';
export class McpTransportError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
export const isMcpTransportError = e => ['MCP_TIMEOUT','MCP_DISCONNECTED','MCP_UNAVAILABLE','MCP_START_FAILED','MCP_PROTOCOL_ERROR'].includes(e?.code);
export class McpClient {
  constructor({timeoutMs=60000}={}) {
    this.timeoutMs=timeoutMs; this.pending=new Map(); this.id=0; this.buffer=''; this.proc=null;
  }
  async start(command,args,env={},passphrase) {
    if(this.proc) this.stop();
    this.buffer='';
    const proc=spawn(command,args,{env:{...process.env,...env},stdio:['pipe','pipe','pipe',...(passphrase===undefined?[]:['pipe'])]});
    this.proc=proc;
    const fail=(message,code)=>{if(this.proc===proc)this.terminate(new McpTransportError(message,code));};
    proc.stdin.on('error',()=>fail('MCP desconectado','MCP_DISCONNECTED'));
    if(passphrase!==undefined){proc.stdio[3].on('error',()=>fail('MCP não iniciou','MCP_START_FAILED'));proc.stdio[3].end(passphrase);passphrase=undefined;}
    // Decode across chunk boundaries; never silently discard a broken response.
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data',data=>{
      if(this.proc!==proc)return;
      this.buffer+=data;
      let i;
      while((i=this.buffer.indexOf('\n'))>=0){
        if(i>8*1024*1024){fail('Resposta MCP excede o limite','MCP_PROTOCOL_ERROR');return;}
        const line=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+1);
        if(!line.trim())continue;
        let msg;try{msg=JSON.parse(line)}catch{fail('Resposta MCP inválida','MCP_PROTOCOL_ERROR');return;}
        const p=this.pending.get(msg.id);
        if(p){clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);}
      }
      if(this.buffer.length>8*1024*1024)fail('Resposta MCP excede o limite','MCP_PROTOCOL_ERROR');
    });
    proc.stdout.on('end',()=>fail('MCP desconectado','MCP_DISCONNECTED'));
    proc.stderr.on('data',()=>{}); // No memory, arguments or credentials in logs.
    proc.on('error',()=>fail('MCP não iniciou','MCP_START_FAILED'));
    proc.on('exit',()=>fail('MCP desconectado','MCP_DISCONNECTED'));
    try{
      await this.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'keepmind-ui',version:'1.0'}});
      if(this.proc!==proc)throw new McpTransportError('MCP desconectado','MCP_DISCONNECTED');
      proc.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
      return this;
    }catch(e){if(this.proc===proc)this.terminate(e);throw e;}
  }
  request(method,params={}) {
    const id=++this.id;
    return new Promise((resolve,reject)=>{
      if(!this.proc?.stdin?.writable){reject(new McpTransportError('MCP indisponível','MCP_UNAVAILABLE'));return;}
      const timer=setTimeout(()=>{
        console.warn(JSON.stringify({event:'keepmind_mcp_timeout',method,tool:method==='tools/call'?params.name:undefined}));
        this.terminate(new McpTransportError('Tempo limite do MCP','MCP_TIMEOUT'));
      },this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');}
      catch{this.terminate(new McpTransportError('MCP desconectado','MCP_DISCONNECTED'));}
    });
  }
  async call(name,args={}) {
    const r=await this.request('tools/call',{name,arguments:args});
    const text=(r?.content||[]).map(c=>c.text||'').join('\n');
    if(r?.isError||/^error:|^refused:/i.test(text))throw Error(text||'Operação recusada');
    return text;
  }
  fail(error) {
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(typeof error==='string'?new Error(error):error)}
    this.pending.clear();
  }
  terminate(error) {
    const proc=this.proc;this.proc=null;this.buffer='';this.fail(error);
    if(proc){proc.kill('SIGTERM');const force=setTimeout(()=>{if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL')},500);force.unref();proc.once('exit',()=>clearTimeout(force));}
  }
  stop(){this.terminate(new McpTransportError('MCP bloqueado','MCP_CLOSED'));}
}
