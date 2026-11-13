// Bundled WhatsApp MCP server — Baileys (whatsapp-web style, QR pairing).
// Speaks MCP over stdio (newline-delimited JSON-RPC 2.0).
// NOTE: uses the unofficial Baileys library; WhatsApp may ban numbers that
// automate heavily. This is an opt-in connector.

// Deps are externalized at build time — require() yields the CJS namespace,
// so the callable socket factory lives on .default (or the namespace itself).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const baileys: any = require('@whiskeysockets/baileys')
const makeWASocket: any = baileys.default ?? baileys
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  Browsers
} = baileys
import type { Boom } from '@hapi/boom'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { TrackedWhatsappDelivery, WhatsappEventBuffer, whatsappRecipient } from './whatsapp-delivery'

const SESSION_DIR = process.env.WA_SESSION_DIR ?? join(process.cwd(), 'wa-session')
const QR_FILE = join(SESSION_DIR, 'qr.txt')
mkdirSync(SESSION_DIR, { recursive: true })

let sock: any = null
let connected = false
const messageStore: { id: string; from: string; body: string; ts: number }[] = []
const eventStore = new WhatsappEventBuffer()
const trackedDelivery = new TrackedWhatsappDelivery(async (jid, text) => {
  if (!connected || !sock) throw Error('WHATSAPP_NOT_CONNECTED')
  return sock.sendMessage(jid, { text })
}, event => eventStore.add(event))

function writeQr(data: string) {
  QRCode.toDataURL(data, { margin: 1, width: 320 })
    .then((url: string) => writeFileSync(QR_FILE, url, 'utf8'))
    .catch(() => writeFileSync(QR_FILE, data, 'utf8'))
}

async function startSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
  const { version } = await fetchLatestBaileysVersion()
  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, undefined as any)
    },
    browser: Browsers.macOS('KeepMind'),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (u: any) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) writeQr(qr)
    if (connection === 'open') {
      connected = true
      writeFileSync(QR_FILE, 'CONNECTED', 'utf8')
    }
    if (connection === 'close') {
      connected = false
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(startSocket, 3000) // reconnect unless logged out
      } else {
        writeFileSync(QR_FILE, 'LOGGED_OUT', 'utf8')
      }
    }
  })

  sock.ev.on('messages.upsert', ({ messages }: any) => {
    for (const m of messages) {
      const body = m.message?.conversation
        ?? m.message?.extendedTextMessage?.text
        ?? m.message?.imageMessage?.caption
        ?? ''
      if (!body) continue
      const peer = jidNormalizedUser(m.key.remoteJid ?? '')
      const ts = Number(m.messageTimestamp ?? 0) * 1000
      if (!Number.isFinite(ts) || ts <= 0 || !m.key.id) continue
      eventStore.add({ id: m.key.id, peer, body, direction: m.key.fromMe ? 'outbound' : 'inbound', occurredAt: new Date(ts).toISOString() })
      if (m.key.fromMe || messageStore.some(item => item.id === m.key.id && item.from === peer)) continue
      messageStore.push({
        id: m.key.id,
        from: peer,
        body,
        ts
      })
      if (messageStore.length > 500) messageStore.shift()
    }
  })
}

const TOOLS = [
  {
    name: 'whatsapp_status',
    description: 'Check WhatsApp connection status and whether a QR code is pending.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'whatsapp_qr',
    description: 'Get the current QR code as a data URL for display (empty when connected).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'whatsapp_send',
    description: 'Send a WhatsApp text message to a phone number (with country code, e.g. 5511999999999) or jid.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Phone number with country code or full jid' },
        text: { type: 'string' }
      },
      required: ['to', 'text']
    }
  },
  {
    name: 'whatsapp_send_tracked',
    description: 'Internal CRM delivery transport. Requires a stable request ID and returns a provider receipt; never retry an uncertain result.',
    inputSchema: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string', maxLength: 4000 }, requestId: { type: 'string' } }, required: ['to', 'text', 'requestId'], additionalProperties: false }
  },
  {
    name: 'whatsapp_events',
    description: 'Internal CRM synchronization: structured recent messages observed while this connector is running, including direction and provider ID.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false }
  },
  {
    name: 'whatsapp_messages',
    description: 'List recent incoming WhatsApp messages captured by the bridge.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max messages to return (default 20)' },
        from: { type: 'string', description: 'Optional sender filter' }
      }
    }
  }
]

async function callTool(name: string, args: any): Promise<string> {
  switch (name) {
    case 'whatsapp_status':
      return JSON.stringify({ connected, qrPending: existsSync(QR_FILE) && readFileSync(QR_FILE, 'utf8') !== 'CONNECTED' })
    case 'whatsapp_qr': {
      if (!existsSync(QR_FILE)) return ''
      const v = readFileSync(QR_FILE, 'utf8')
      return v === 'CONNECTED' || v === 'LOGGED_OUT' ? '' : v
    }
    case 'whatsapp_send': {
      if (!connected || !sock) return 'WhatsApp not connected'
      const jid = whatsappRecipient(args.to)
      await sock.sendMessage(jid, { text: String(args.text) })
      return `Sent to ${jid}`
    }
    case 'whatsapp_send_tracked':
      return JSON.stringify(await trackedDelivery.send(args.to, args.text, args.requestId))
    case 'whatsapp_events':
      return JSON.stringify({ events: eventStore.list(Number(args.limit ?? 100)), coverage: 'observed-while-connected' })
    case 'whatsapp_messages': {
      const limit = Number(args.limit ?? 20)
      const from = args.from ? String(args.from) : null
      const msgs = messageStore
        .filter(m => !from || m.from.includes(from))
        .slice(-limit)
        .map(m => `[${new Date(m.ts).toISOString()}] ${m.from}: ${m.body}`)
      return msgs.join('\n') || 'No messages yet'
    }
    default:
      return `Unknown tool: ${name}`
  }
}

// ── Minimal MCP stdio loop ──

let buffer = ''
const pending = new Map<number, (v: any) => void>()
let nextId = 1

function send(msg: any) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function handle(msg: any) {
  const { id, method, params } = msg
  if (id === undefined) return // notification
  const reply = (result: any) => send({ jsonrpc: '2.0', id, result })
  const fail = (message: string) => send({ jsonrpc: '2.0', id, error: { code: -32603, message } })

  switch (method) {
    case 'initialize':
      reply({
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'keepmind-whatsapp', version: '0.1.0' }
      })
      break
    case 'tools/list':
      reply({ tools: TOOLS })
      break
    case 'tools/call':
      callTool(params?.name, params?.arguments ?? {})
        .then(r => reply({ content: [{ type: 'text', text: r }] }))
        .catch(e => fail(String(e?.message ?? e)))
      break
    case 'ping':
      reply({})
      break
    default:
      fail(`Method not found: ${method}`)
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  buffer += chunk.toString()
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    try { handle(JSON.parse(line)) } catch { /* ignore malformed */ }
  }
})

process.stdin.on('end', () => process.exit(0))

startSocket().catch(e => {
  process.stderr.write(`whatsapp socket failed: ${e}\n`)
})
