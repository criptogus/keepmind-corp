import { existsSync } from 'node:fs'
import { CrmService, type CrmAction, type CrmActor, type CrmSnapshot, type Draft } from '../../../tools/lib/crm.mjs'
import { assertNoSymlinkPath, withProjectLock } from '../../../tools/lib/continuity.mjs'
import { extractCrmCapture, crmDraftPrompt, parseCrmDraft, type CrmCompletion } from '../../../tools/lib/crm-assistant.mjs'
import type { Memory } from './brain/memory-store'
import { whatsappRecipient } from '../mcp/whatsapp-delivery'

export function createCrmService(memory: Memory) {
  return new CrmService({
    read: path => {
      const value = memory.read(path)
      if (value === null && existsSync(memory.resolve(path))) throw Error('CRM_ACCESS_DENIED')
      return value
    }, write: (path, content) => memory.write(path, content),
    list: dir => memory.list(dir), scopePath: path => memory.scopePath(path), space: () => memory.currentSpace,
    assertEvidencePath: path => assertNoSymlinkPath(memory.resolve('.'), path),
    withLock: (path, fn) => withProjectLock(memory.resolve(path), fn)
  })
}

interface Transport {
  allTools(): Array<{ serverId: string; tool: { name: string } }>
  callTool(server: string, tool: string, args: Record<string, unknown>): Promise<string>
}
interface Dependencies { complete?: CrmCompletion; transport?(): Transport | null; changed?(): void }
const timeout = <T>(promise: Promise<T>, ms: number): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('CRM_CONNECTOR_TIMEOUT')), ms)
  promise.then(resolve, reject).finally(() => clearTimeout(timer))
})
const digits = (text: string) => text.replace(/\D/g, '')

/** Native application boundary. Only the UI may request a manual send; agents
 * use the stored policy. Actual provider I/O is never part of the shared core. */
export class CrmWorkflow {
  private running = new Set<string>()
  private deliveries = new Set<string>()
  constructor(private memory: Memory, private dependencies: Dependencies = {}) {}
  private service() { return createCrmService(this.memory) }
  private whatsapp() {
    return this.dependencies.transport?.()?.allTools().find(item => item.tool.name === 'whatsapp_send_tracked')?.serverId
  }
  private result(snapshot: CrmSnapshot) {
    const available = !!this.whatsapp()
    return { ...snapshot, capabilities: {
      canWrite: true, canConfigure: true, canSend: available, canSync: available, sendChannels: available ? ['whatsapp'] : [], canAutomate: true,
      boards: [{ id: 'personal', label: 'Espaço atual' }], activeBoard: 'personal', storageScope: `native:${this.memory.currentSpace}`
    } }
  }
  dispatch(action: string, input: Record<string, unknown> = {}, actor: CrmActor = 'human'): Promise<any> {
    return this.memory.withScope(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 65536) throw Error('CRM_INVALID_REQUEST')
      if (input.board && input.board !== 'personal') throw Error('CRM_BOARD_UNAVAILABLE')
      const { board: _board, actor: _actor, ...args } = input
      if (['begin_delivery', 'complete_delivery'].includes(action)) throw Error('CRM_CONNECTOR_ONLY')
      if (action === 'send_draft') return this.send(args, actor === 'human' ? 'manual' : 'automatic')
      const service = this.service()
      if (action === 'capture') {
        // A caller cannot smuggle model-supplied identities or dates past this boundary.
        const { extraction } = await extractCrmCapture(String(args.text ?? ''), { complete: this.dependencies.complete, timeZone: typeof args.timeZone === 'string' ? args.timeZone : undefined })
        args.extraction = extraction
      }
      if (action === 'context') return service.dispatch('context', args as { contactId: string }, actor)
      const state = service.dispatch(action as CrmAction, args, actor)
      if (action === 'prepare_draft' && this.dependencies.complete && args.smart !== false) {
        const draftId = state.lastResult?.draftId
        const draft = state.drafts.find(d => d.id === draftId)
        if (draft) {
          try {
            const context = service.dispatch('context', { contactId: draft.contactId }, actor)
            const suggestion = parseCrmDraft(await this.dependencies.complete(crmDraftPrompt(context.text, draft)))
            const updated = service.dispatch('update_draft', { draftId, expectedRevision: state.revision, ...suggestion }, actor)
            this.dependencies.changed?.()
            return this.result(updated)
          } catch { /* The useful saved draft survives model unavailability or an intervening edit. */ }
        }
      }
      if (action !== 'snapshot') this.dependencies.changed?.()
      return this.result(state)
    })
  }

  private async send(args: Record<string, unknown>, mode: 'manual' | 'automatic') {
    const service = this.service(), transport = this.dependencies.transport?.(), server = this.whatsapp()
    const state = service.dispatch('snapshot'), draft = state.drafts.find(d => d.id === args.draftId)
    if (!draft) throw Error('DRAFT_NOT_FOUND')
    if (draft.channel !== 'whatsapp') throw Error('CRM_CHANNEL_NOT_CONNECTED')
    if (!transport || !server) throw Error('CRM_WHATSAPP_NOT_CONNECTED')
    const key = `${this.memory.currentSpace}:${draft.id}`
    if (this.deliveries.has(key)) throw Error('CRM_DELIVERY_BUSY')
    this.deliveries.add(key)
    try {
      let connection: any
      try { connection = JSON.parse(await timeout(transport.callTool(server, 'whatsapp_status', {}), 5000)) } catch { throw Error('CRM_WHATSAPP_NOT_CONNECTED') }
      if (connection?.connected !== true) throw Error('CRM_WHATSAPP_NOT_CONNECTED')
      if (mode === 'automatic') {
        if (!state.settings.syncConnectedChannels) throw Error('CRM_SYNC_REQUIRED')
        if (!await this.ingestWhatsapp(service)) throw Error('CRM_SYNC_UNAVAILABLE')
      }
      whatsappRecipient(state.contacts.find(c => c.id === draft.contactId)?.phone)
      const sending = service.dispatch('begin_delivery', { draftId: draft.id, expectedRevision: args.expectedRevision, mode }, 'connector')
      const contact = sending.contacts.find(c => c.id === draft.contactId)!
      let receipt = '', outcome: 'sent' | 'unknown' = 'unknown'
      try {
        const response = JSON.parse(await timeout(transport.callTool(server, 'whatsapp_send_tracked', { to: contact.phone, text: draft.body, requestId: draft.id }), 30000))
        if (response?.ok === true && typeof response.receipt === 'string' && response.receipt.length > 0) { receipt = response.receipt; outcome = 'sent' }
      } catch { /* A timeout is not evidence of a failed send. Never blindly retry. */ }
      // Provider is called exactly once. Only persistence may be retried after a concurrent update.
      for (let retry = 0; retry < 3; retry++) {
        const current = service.dispatch('snapshot')
        try {
          const finished = service.dispatch('complete_delivery', { draftId: draft.id, expectedRevision: current.revision, status: outcome,
            ...(receipt ? { receipt } : { error: 'Não foi possível confirmar o envio. Confira a conversa antes de tentar outra mensagem.' }) }, 'connector')
          this.dependencies.changed?.()
          return this.result(finished)
        } catch (error) { if (!(error instanceof Error) || error.message !== 'REVISION_CONFLICT' || retry === 2) throw error }
      }
    } finally { this.deliveries.delete(key) }
    throw Error('CRM_DELIVERY_RECORD_FAILED')
  }

  private async ingestWhatsapp(service: CrmService) {
    const transport = this.dependencies.transport?.()
    const source = transport?.allTools().find(item => item.tool.name === 'whatsapp_events')
    if (!source || !transport) return false
    let data: any
    try { data = JSON.parse(await timeout(transport.callTool(source.serverId, 'whatsapp_events', { limit: 500 }), 5000)) } catch { return false }
    if (!data || !Array.isArray(data.events) || data.events.length > 500) return false
    let snapshot = service.dispatch('snapshot')
    const seen = new Set(snapshot.interactions.map(i => `${i.channel}:${i.source.externalId ?? ''}`))
    for (const event of data.events) {
      if (!event || typeof event.id !== 'string' || event.id.length > 200 || typeof event.peer !== 'string' || typeof event.body !== 'string' || !event.body.trim() || event.body.length > 4000 || !['inbound', 'outbound'].includes(event.direction) || typeof event.occurredAt !== 'string' || Number.isNaN(Date.parse(event.occurredAt))) continue
      if (/@(?:g\.us|lid)$/.test(event.peer)) continue
      const externalId = `${source.serverId}:${event.id}`
      if (seen.has(`whatsapp:${externalId}`) || snapshot.interactions.some(i => i.source.externalId === event.id)) continue
      const matches = snapshot.contacts.filter(c => !c.archivedAt && c.phone && digits(c.phone) === digits(event.peer.split('@')[0]))
      if (matches.length !== 1) continue // No automatic contact creation or guessing an ambiguous identity.
      snapshot = service.dispatch('record_interaction', { contactId: matches[0].id, channel: 'whatsapp', direction: event.direction,
        body: event.body, occurredAt: event.occurredAt, source: { externalId } }, 'connector')
      seen.add(`whatsapp:${externalId}`)
    }
    return true
  }

  tick(): Promise<void> {
    return this.memory.withScope(async () => {
      const space = this.memory.currentSpace
      if (this.running.has(space)) return
      const path = this.memory.scopePath('crm/relationships.md')
      assertNoSymlinkPath(this.memory.resolve('.'), path)
      if (!existsSync(this.memory.resolve(path))) return
      this.running.add(space)
      try {
        const service = this.service(), before = service.dispatch('snapshot').revision
        if ((service.dispatch('snapshot').settings as { syncConnectedChannels?: boolean }).syncConnectedChannels) await this.ingestWhatsapp(service)
        let state = service.dispatch('snapshot')
        for (const stale of state.drafts.filter(d => d.status === 'sending' && Date.now() - Date.parse(d.updatedAt) > 120000 && !this.deliveries.has(`${space}:${d.id}`))) {
          state = service.dispatch('complete_delivery', { draftId: stale.id, expectedRevision: state.revision, status: 'unknown', error: 'Envio interrompido. Confira o canal antes de repetir.' }, 'connector')
        }
        if (state.settings.autoPrepare) state = service.dispatch('review', { expectedRevision: state.revision }, 'agent')
        if (state.settings.allowAutomaticSend && this.whatsapp()) {
          for (const candidate of state.drafts.filter(d => d.status === 'draft' && d.channel === 'whatsapp' && (d as Draft & { autoPrepared?: boolean }).autoPrepared).slice(0, 10)) {
            try { state = await this.send({ draftId: candidate.id, expectedRevision: state.revision }, 'automatic') }
            catch (error) { if (error instanceof Error && error.message === 'DAILY_SEND_LIMIT') break; state = service.dispatch('snapshot') }
          }
        }
        if (state.revision !== before) this.dependencies.changed?.()
      } finally { this.running.delete(space) }
    })
  }
}
