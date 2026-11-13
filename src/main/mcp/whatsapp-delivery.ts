import { createHash } from 'node:crypto'

export interface WhatsappEvent {
  id: string
  peer: string
  body: string
  direction: 'inbound' | 'outbound'
  occurredAt: string
}

/** A bounded view of messages observed by this connector, not a history export. */
export class WhatsappEventBuffer {
  private events = new Map<string, WhatsappEvent>()
  add(event: WhatsappEvent) {
    if (!event.id || !event.peer || !event.body || Number.isNaN(Date.parse(event.occurredAt))) return
    const key = `${event.peer}:${event.id}`
    if (this.events.has(key)) return
    this.events.set(key, event)
    while (this.events.size > 500) this.events.delete(this.events.keys().next().value!)
  }
  list(limit = 100) {
    const count = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.floor(limit))) : 100
    return [...this.events.values()].slice(-count)
  }
}

export function whatsappRecipient(value: unknown) {
  if (typeof value !== 'string' || !/^\+?[\d ()-]+(?:@s\.whatsapp\.net)?$/.test(value.trim())) throw Error('INVALID_RECIPIENT')
  const phone = value.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '')
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw Error('INVALID_RECIPIENT')
  return `${phone}@s.whatsapp.net`
}

type ProviderSend = (jid: string, text: string) => Promise<{ key?: { id?: string | null } } | undefined>
export type DeliveryResult = { ok: true; receipt: string } | { ok: false; uncertain: true; error: string }

/** Concurrent requests share one provider call. Durable status lives in the CRM;
 * an uncertain provider result is retained here and never automatically retried. */
export class TrackedWhatsappDelivery {
  private requests = new Map<string, { fingerprint: string; result: Promise<DeliveryResult> }>()
  constructor(private provider: ProviderSend, private observed: (event: WhatsappEvent) => void) {}
  send(to: unknown, text: unknown, requestId: unknown): Promise<DeliveryResult> {
    const jid = whatsappRecipient(to)
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw Error('INVALID_MESSAGE')
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(requestId)) throw Error('INVALID_REQUEST_ID')
    const fingerprint = createHash('sha256').update(JSON.stringify([jid, text])).digest('hex')
    const existing = this.requests.get(requestId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw Error('REQUEST_ID_REUSED')
      return existing.result
    }
    // Never evict an unknown outcome and then accidentally send it again.
    if (this.requests.size >= 10000) throw Error('DELIVERY_SESSION_CAPACITY')
    const result = Promise.resolve().then(async (): Promise<DeliveryResult> => {
      try {
        const sent = await this.provider(jid, text)
        const receipt = sent?.key?.id
        if (typeof receipt !== 'string' || !receipt || receipt.length > 200) throw Error('NO_RECEIPT')
        this.observed({ id: receipt, peer: jid, body: text, direction: 'outbound', occurredAt: new Date().toISOString() })
        return { ok: true, receipt }
      } catch {
        return { ok: false, uncertain: true, error: 'Confira a conversa: o canal não confirmou o envio.' }
      }
    })
    this.requests.set(requestId, { fingerprint, result })
    return result
  }
}
