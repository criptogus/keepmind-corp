import {isMcpTransportError,McpTransportError} from './mcp-client.mjs';
const reads=new Set(['km_status','sb_list','sb_read','sb_search','sb_context','sb_task_context','km_usage','km_value','km_graph','km_learning_list','km_learning_source','km_archive_list']);
// In-flight deduplication only. No retained memory cache and no replay of mutations.
export class McpConnection {
  constructor({open,recoverReads=false}){this.open=open;this.recoverReads=recoverReads;this.client=null;this.opening=null;this.reads=new Map();this.generation=0;this.closed=false;}
  ensure(passphrase){
    if(this.closed)return Promise.reject(new McpTransportError('MCP bloqueado','MCP_CLOSED'));
    if(this.client)return Promise.resolve(this.client);
    if(this.opening)return this.opening;
    const generation=this.generation;
    const pending=(async()=>{const client=await this.open(passphrase);if(this.closed||generation!==this.generation){client.stop();throw new McpTransportError('MCP bloqueado','MCP_CLOSED')}this.client=client;return client;})();
    this.opening=pending;
    const clear=()=>{if(this.opening===pending)this.opening=null};pending.then(clear,clear);
    return pending;
  }
  invalidate(client){if(client&&this.client===client){this.client=null;client.stop();}}
  async attempt(name,args,read,generation){
    for(let attempt=0;attempt<2;attempt++){
      if(this.closed||generation!==this.generation)throw new McpTransportError('MCP bloqueado','MCP_CLOSED');
      let client;
      try{client=await this.ensure();return await client.call(name,args);}
      catch(e){
        if(!isMcpTransportError(e))throw e;
        this.invalidate(client);
        if(!read&&client){const uncertain=new McpTransportError('Conexão interrompida durante a gravação. Confira o resultado antes de repetir.','MCP_WRITE_UNCERTAIN');uncertain.cause=e;throw uncertain;}
        if(!read||!this.recoverReads||attempt===1)throw e;
      }
    }
  }
  call(name,args={}){
    const read=reads.has(name),key=JSON.stringify([name,args]);
    if(read&&this.reads.has(key))return this.reads.get(key);
    const promise=this.attempt(name,args,read,this.generation);
    if(read){this.reads.set(key,promise);const clear=()=>{if(this.reads.get(key)===promise)this.reads.delete(key)};promise.then(clear,clear);}
    return promise;
  }
  async replace(passphrase){this.stop();this.closed=false;return this.ensure(passphrase);}
  stop(){this.closed=true;this.generation++;this.reads.clear();const client=this.client;this.client=null;this.opening=null;client?.stop();}
}
