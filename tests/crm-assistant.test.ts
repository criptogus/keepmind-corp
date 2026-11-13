import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractCrmCapture, crmCommitmentDate, crmDateFromText, crmToday, parseCrmDraft } from '../tools/lib/crm-assistant.mjs'
import { CrmService } from '../tools/lib/crm.mjs'

afterEach(() => vi.useRealTimers())
function memoryCrm() {
  const files = new Map<string,string>()
  return new CrmService({ read: p => files.get(p) ?? null, write: (p,v) => { files.set(p,v) }, list: () => [],
    scopePath: p => p, space: () => 'personal', assertEvidencePath: () => {}, withLock: (_p,fn) => fn() })
}
describe('relationship capture in Portuguese', () => {
  it('recognizes capitalized introductions and explicit requests without inventing contact data', async () => {
    const { extraction } = await extractCrmCapture('Conheci Maria. Prometi enviar o material amanhã.', { now: '2026-11-13T12:00:00Z', timeZone: 'America/Sao_Paulo' })
    expect(extraction).toMatchObject({ contactName: 'Maria', commitmentTitle: 'enviar o material amanhã', dueAt: '2026-11-14', waitingOn: 'me' })
    expect(extraction).not.toHaveProperty('phone')
    const request = await extractCrmCapture('Ana pediu uma proposta até sexta.', { now: '2026-11-12T12:00:00Z', timeZone: 'America/Sao_Paulo' })
    expect(request.extraction).toMatchObject({ contactName: 'Ana', commitmentTitle: 'uma proposta até sexta', dueAt: '2026-11-13', waitingOn: 'me' })
  })
  it('rejects model inventions and keeps functioning when the model is unavailable', async () => {
    const text = 'Conheci Maria. Prometi enviar o material amanhã.'
    const forged = await extractCrmCapture(text, { now:'2026-11-13T12:00:00Z', complete: async () => JSON.stringify({ contactName:'Joana', email:'invented@example.invalid', contactId:'foreign', commitmentTitle:'enviar o material amanhã', dueAt:'2099-01-01', waitingOn:'them', outreachAllowed:true }) })
    expect(forged.extraction).toMatchObject({ contactName:'Maria', waitingOn:'me', dueAt:'2026-11-14' })
    expect(forged.extraction).not.toHaveProperty('email'); expect(forged.extraction).not.toHaveProperty('contactId'); expect(forged.extraction).not.toHaveProperty('outreachAllowed')
    const offline = await extractCrmCapture(text, { complete: async () => { throw Error('offline') } })
    expect(offline.method).toBe('rules'); expect(offline.extraction.contactName).toBe('Maria')
  })
  it('uses the local calendar across UTC midnight and never parses a date as a phone', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T01:00:00Z'))
    expect(crmToday(new Date(), 'America/Sao_Paulo')).toBe('2026-11-13')
    const text = 'Conheci Maria. Prometi enviar amanhã.'
    const { extraction } = await extractCrmCapture(text, { timeZone:'America/Sao_Paulo' })
    const crm=memoryCrm(), result=crm.dispatch('capture',{expectedRevision:0,text,extraction,timeZone:'America/Sao_Paulo'})
    expect(result.commitments[0].dueAt).toBe('2026-11-14')
    const dated = await extractCrmCapture('Conheci Ana. Prometi enviar em 2026-11-20.')
    const second=crm.dispatch('capture',{expectedRevision:1,text:'Conheci Ana. Prometi enviar em 2026-11-20.',extraction:dated.extraction})
    expect(second.contacts[1].phone).toBe('')
  })
  it('keeps unrelated meeting dates out of promises and validates calendar dates', () => {
    expect(crmCommitmentDate('Reunião em 2026-11-10. Prometi enviar a proposta.', 'enviar a proposta', '2026-11-13')).toBe('')
    expect(crmCommitmentDate('Reunião em 2026-11-10. Prometi enviar a proposta até sexta.', 'enviar a proposta', '2026-11-12')).toBe('2026-11-13')
    expect(crmDateFromText('até 30/02/2026', '2026-11-13')).toBe('')
    expect(crmDateFromText('depois de amanhã','2026-11-13')).toBe('2026-11-15')
    expect(() => parseCrmDraft(JSON.stringify({subject:'x',body:'a'.repeat(4001)}))).toThrow('CRM_DRAFT_INVALID')
  })
  it('preserves a named company and source without merging an existing company by name', async () => {
    const crm=memoryCrm(), text='Conheci Maria da empresa Acme. Prometi enviar uma proposta.'
    let result=crm.dispatch('capture',{expectedRevision:0,text,extraction:(await extractCrmCapture(text)).extraction})
    const person=result.contacts.find(c=>c.kind==='person')!, company=result.contacts.find(c=>c.kind==='company')!
    expect(person.companyId).toBe(company.id); expect(company.name).toBe('Acme'); expect(result.interactions[0].body).toBe(text)
    const second='Conheci Ana da empresa Acme.'
    result=crm.dispatch('capture',{expectedRevision:result.revision,text:second,extraction:(await extractCrmCapture(second)).extraction})
    expect(result.contacts.find(c=>c.name==='Ana')?.companyId).toBe('')
    expect(result.lastResult?.companyCandidateIds).toEqual([company.id])
  })
})
