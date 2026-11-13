import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classify, detections, redact } from '../src/main/services/security/classification'
import { scanText } from '../corp/lib.mjs'
import { createMemoryServer } from '../tools/keepmind-mcp.mjs'

const uuid='123e4567-e89b-12d3-a456-123456789012'
const dirs:string[]=[]
afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})))

it('preserves canonical UUID identifiers while still classifying and redacting real PII',()=>{
 const text=`{"id":"${uuid}"}`
 expect(classify(text)).toBe('internal');expect(detections(text)).toEqual([]);expect(redact(text)).toEqual({text,count:0})
 const withPhone=`${text} telefone +5511999999999`;expect(classify(withPhone)).toBe('sensitive');expect(detections(withPhone).some(d=>d.kind==='phone-digits')).toBe(true);const redacted=redact(withPhone);expect(redacted.text).toContain(uuid);expect(redacted.text).not.toContain('+5511999999999')
 for(const pii of ['111.222.333-44','12.345.678/0001-99','ana@example.com']) expect(classify(`${text} ${pii}`)).toBe('sensitive')
})
it('never suppresses secrets containing UUIDs',()=>{const token=`sk-${uuid}`;expect(classify(token)).toBe('secret');expect(detections(token).some(d=>d.secret)).toBe(true);expect(redact(token).text).not.toContain(token);expect(scanText('fixture',token).secrets).not.toHaveLength(0)})
it('keeps MCP and Corp scanning aligned without concealing real PII',()=>{
 const root=mkdtempSync(join(tmpdir(),'uuid-mcp-'));dirs.push(root);const handle=createMemoryServer(root,{allowPlaintext:true,clients:{default:{spaces:['personal'],maxClass:'internal',write:true}}});const call=(name:string,args:any)=>handle({id:1,method:'tools/call',params:{name,arguments:args}}).result
 expect(call('sb_write',{path:'notes/uuid.md',content:`ID ${uuid}`}).isError).toBeUndefined();expect(call('sb_read',{path:'notes/uuid.md'}).content[0].text).toContain(uuid);expect(call('sb_write',{path:'notes/phone.md',content:`ID ${uuid} phone +5511999999999`}).isError).toBe(true);expect(call('sb_write',{path:'notes/secret.md',content:`sk-${uuid}`}).isError).toBe(true)
 expect(scanText('fixture',uuid).pii).toHaveLength(0);expect(scanText('fixture',`${uuid} 111.222.333-44`).pii.some((x:any)=>x.label==='cpf')).toBe(true)
})
