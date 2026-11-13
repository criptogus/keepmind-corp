import { gate, isLocalEndpoint, egressContext, type EgressContext } from './security/egress'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AiProviderConfig } from '../store'
import { redactSecrets, isLocalProvider } from './redact'

// Memory content can contain credentials (the vault is user-owned Markdown,
// synced from anywhere). Before messages leave for a CLOUD provider, mask
// secret-shaped spans — local providers (llama.cpp, Ollama) get plaintext
// since inference never leaves the machine.
function scrubForProvider(aiCfg: AiProviderConfig, messages: ChatMessage[]): ChatMessage[] {
  if (isLocalProvider(aiCfg.provider)) return messages
  return messages.map(m => ({ ...m, content: redactSecrets(m.content) }))
}

// Resolve the effective provider config. The bundled 'local' provider talks to
// the llama-server OpenAI-compatible endpoint managed by LocalLlm.
export function effectiveConfig(ai: AiProviderConfig, localEndpoint?: string): AiProviderConfig {
  if (ai.provider === 'local') {
    return {
      provider: 'openai',
      baseUrl: localEndpoint ?? 'http://127.0.0.1:8765/v1',
      apiKey: 'local',
      model: ai.model
    }
  }
  return ai
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
}

export interface LlmResponse {
  text: string
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
}

const MODELS: Record<string, string[]> = {
  local: ['qwen2.5-3b', 'smollm2-1.7b', 'llama3.2-3b', 'qwen2.5-7b'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  'claude-oauth': ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o4-mini'],
  codex: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-sol'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  grok: ['grok-4', 'grok-3', 'grok-3-mini'],
  ollama: ['llama3.1', 'qwen2.5', 'mistral']
}

// Providers with a fixed catalog reject unknown model ids (ChatGPT's Codex
// backend 400s on e.g. 'qwen2.5-3b' left over from the local provider).
// Fall back to the provider default when cfg.model isn't in the list.
// Ollama/local are exempt — their model names are user-defined/free-form.
function pickModel(provider: string, cfg: AiProviderConfig): string {
  const list = provider === 'codex' ? codexModels() : MODELS[provider]
  if (cfg.model && list?.includes(cfg.model)) return cfg.model
  return list?.[0] ?? cfg.model ?? ''
}

// Safe execution metadata; credentials and endpoint configuration stay private.
export function completionIdentity(ai: AiProviderConfig): { provider: string; model: string } {
  // Ollama accepts arbitrary installed model names; mirror callOllama rather
  // than the fixed-catalog fallback used by cloud providers.
  const model = ai.provider === 'ollama' ? ai.model ?? MODELS.ollama[0] : pickModel(ai.provider, ai)
  return { provider: ai.provider, model }
}

export function listProviders() {
  const names: Record<string, string> = {
    local: 'Local (built-in, offline)',
    anthropic: 'Claude API key',
    'claude-oauth': 'Claude (Pro/Max sign-in)',
    openai: 'OpenAI API key',
    codex: 'Codex / ChatGPT sign-in',
    gemini: 'Google Gemini API key',
    grok: 'Grok (xAI API key)',
    ollama: 'Ollama (local)'
  }
  return Object.keys(MODELS).map(id => ({
    id,
    name: names[id]!,
    models: id === 'codex' ? codexModels() : MODELS[id]!,
    needsKey: !['ollama', 'local', 'codex'].includes(id)
  }))
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, {
    method: 'POST', redirect: 'error',
    signal,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Model request failed: ${res.status}`)
  return res.json()
}

async function callAnthropic(cfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LlmResponse> {
  const { system, rest } = splitSystem(messages)
  const body: any = {
    model: pickModel('anthropic', cfg),
    max_tokens: 4096,
    messages: rest.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content }))
  }
  if (system) body.system = system
  if (tools.length) {
    body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  }
  const data = await post('https://api.anthropic.com/v1/messages', body, {
    'x-api-key': cfg.apiKey!,
    'anthropic-version': '2023-06-01'
  }, signal)
  const text = data.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') ?? ''
  const toolCalls = (data.content ?? []).filter((b: any) => b.type === 'tool_use').map((b: any) => ({
    id: b.id, name: b.name, arguments: b.input ?? {}
  }))
  return { text, toolCalls }
}

async function callOpenAI(cfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LlmResponse> {
  const body: any = {
    model: pickModel(cfg.provider in MODELS ? cfg.provider : 'openai', cfg),
    messages: messages.map(m => ({ role: m.role === 'tool' ? 'tool' : m.role, content: m.content, name: m.name })),
    ...(tools.length ? {
      tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: 'auto'
    } : {})
  }
  const base = cfg.baseUrl ?? 'https://api.openai.com/v1'
  const data = await post(`${base.replace(/\/$/, '')}/chat/completions`, body, {
    Authorization: `Bearer ${cfg.apiKey}`
  }, signal)
  const msg = data.choices?.[0]?.message ?? {}
  const toolCalls = (msg.tool_calls ?? []).map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: safeJson(tc.function.arguments)
  }))
  return { text: msg.content ?? '', toolCalls }
}

async function callGemini(cfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LlmResponse> {
  const { system, rest } = splitSystem(messages)
  const contents = rest.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))
  const body: any = {
    contents,
    generationConfig: { maxOutputTokens: 4096 },
    ...(tools.length ? {
      tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
    } : {})
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  const model = pickModel('gemini', cfg)
  const data = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`,
    body, {}, signal
  )
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('')
  const toolCalls = parts.filter((p: any) => p.functionCall).map((p: any) => ({
    id: `call_${Math.random().toString(36).slice(2)}`,
    name: p.functionCall.name,
    arguments: p.functionCall.args ?? {}
  }))
  return { text, toolCalls }
}

async function callOllama(cfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LlmResponse> {
  const base = cfg.baseUrl ?? 'http://localhost:11434'
  const data = await post(`${base.replace(/\/$/, '')}/api/chat`, {
    model: cfg.model ?? MODELS.ollama[0],
    messages: messages.map(m => ({ role: m.role === 'tool' ? 'tool' : m.role, content: m.content })),
    stream: false,
    ...(tools.length ? {
      tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    } : {})
  }, {}, signal)
  const msg = data.message ?? {}
  const toolCalls = (msg.tool_calls ?? []).map((tc: any) => ({
    id: tc.id ?? `call_${Math.random().toString(36).slice(2)}`,
    name: tc.function?.name ?? tc.name,
    arguments: tc.function?.arguments ?? tc.arguments ?? {}
  }))
  return { text: msg.content ?? '', toolCalls }
}

// ── Codex (ChatGPT sign-in) ──
// Reads credentials written by the official Codex CLI (~/.codex/auth.json)
// and calls the same backend the CLI uses. Refreshes the access token on 401.

const CODEX_AUTH_FILE = join(homedir(), '.codex', 'auth.json')
const CODEX_MODELS_CACHE = join(homedir(), '.codex', 'models_cache.json')
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann' // public Codex CLI client id

// Models the signed-in ChatGPT account actually accepts — the Codex CLI
// refreshes ~/.codex/models_cache.json from the backend, so reading it keeps
// us in sync with account entitlements instead of hardcoding slugs that go
// stale (e.g. 'gpt-5.1-codex' was retired for ChatGPT-account auth).
let codexModelsMemo: { at: number; list: string[] } | null = null
export function codexModels(): string[] {
  if (codexModelsMemo && Date.now() - codexModelsMemo.at < 5 * 60_000) return codexModelsMemo.list
  let list = MODELS.codex
  try {
    const raw = JSON.parse(readFileSync(CODEX_MODELS_CACHE, 'utf8'))
    const slugs = (raw.models ?? [])
      .filter((m: any) => m.supported_in_api && m.visibility === 'list')
      .sort((a: any, b: any) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((m: any) => m.slug)
      .filter(Boolean)
    if (slugs.length) list = slugs
  } catch { /* cache missing → fallback list */ }
  codexModelsMemo = { at: Date.now(), list }
  return list
}

interface CodexAuth {
  tokens?: { access_token?: string; refresh_token?: string; account_id?: string }
  last_refresh?: string
}

function readCodexAuth(): CodexAuth | null {
  try {
    if (!existsSync(CODEX_AUTH_FILE)) return null
    return JSON.parse(readFileSync(CODEX_AUTH_FILE, 'utf8'))
  } catch { return null }
}

export function codexStatus(): { loggedIn: boolean; accountId?: string; email?: string } {
  const a = readCodexAuth()
  if (!a?.tokens?.access_token) return { loggedIn: false }
  let email: string | undefined
  try {
    const payload = JSON.parse(Buffer.from(a.tokens.access_token.split('.')[1], 'base64url').toString())
    email = payload?.email ?? payload?.['https://api.openai.com/profile']?.email
  } catch { /* noop */ }
  return { loggedIn: true, accountId: a.tokens.account_id, email }
}

async function refreshCodexToken(auth: CodexAuth, signal?: AbortSignal): Promise<boolean> {
  const rt = auth.tokens?.refresh_token
  if (!rt) return false
  try {
    const res = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST', redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: rt
      })
    })
    const data = await res.json()
    if (!data.access_token) return false
    auth.tokens = { ...auth.tokens, access_token: data.access_token, refresh_token: data.refresh_token ?? rt }
    auth.last_refresh = new Date().toISOString()
    writeFileSync(CODEX_AUTH_FILE, JSON.stringify(auth, null, 2))
    return true
  } catch (error) { if (signal?.aborted) throw error; return false }
}

async function callCodex(cfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal, retried = false): Promise<LlmResponse> {
  const auth = readCodexAuth()
  const token = auth?.tokens?.access_token
  if (!token) {
    throw new Error('Codex not signed in — install the Codex CLI and run `codex login` first (credentials are read from ~/.codex/auth.json)')
  }
  const { system, rest } = splitSystem(messages)
  const body: any = {
    model: pickModel('codex', cfg),
    instructions: system || 'You are a helpful assistant.',
    input: rest.map(m => ({
      type: 'message',
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }]
    })),
    tools: tools.length ? tools.map(t => ({
      type: 'function', name: t.name, description: t.description,
      parameters: t.parameters, strict: false
    })) : undefined,
    tool_choice: tools.length ? 'auto' : undefined,
    parallel_tool_calls: false,
    store: false,
    stream: true // the Codex backend requires streaming
  }
  const res = await fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST', redirect: 'error',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'chatgpt-account-id': auth!.tokens!.account_id ?? '',
      'OpenAI-Beta': 'responses=experimental',
      'originator': 'codex_cli_rs',
      'accept': 'text/event-stream'
    },
    body: JSON.stringify(body)
  })
  if (res.status === 401 && !retried && auth) {
    if (await refreshCodexToken(auth, signal)) return callCodex(cfg, messages, tools, signal, true)
  }
  if (!res.ok) throw new Error(`Model request failed: ${res.status}`)
  if (!res.body) throw new Error('Codex API returned no body')

  // SSE stream of Responses API events
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let text = ''
  const toolCalls: ToolCall[] = []
  const seenCalls = new Set<string>()
  const handleEvent = (ev: any) => {
    if (ev?.type === 'response.output_text.delta' && ev.delta) text += ev.delta
    else if (ev?.type === 'response.output_item.done' && ev.item?.type === 'function_call') {
      const id = ev.item.call_id ?? ev.item.id
      if (!seenCalls.has(id)) {
        seenCalls.add(id)
        toolCalls.push({ id, name: ev.item.name, arguments: safeJson(ev.item.arguments) })
      }
    } else if (ev?.type === 'response.completed') {
      for (const item of ev.response?.output ?? []) {
        if (item.type === 'message') {
          for (const c of item.content ?? []) if (c.type === 'output_text' && !text.includes(c.text)) text += c.text
        } else if (item.type === 'function_call' && !seenCalls.has(item.call_id ?? item.id)) {
          const id = item.call_id ?? item.id
          seenCalls.add(id)
          toolCalls.push({ id, name: item.name, arguments: safeJson(item.arguments) })
        }
      }
    } else if (ev?.type === 'response.failed' || ev?.type === 'error') {
      throw new Error(`Codex stream error: ${JSON.stringify(ev).slice(0, 200)}`)
    }
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try { handleEvent(JSON.parse(payload)) } catch (e) { if (e instanceof SyntaxError) continue; throw e }
      }
    }
  }
  return { text, toolCalls }
}

// ── Claude via OAuth (Claude Pro/Max "setup-token") ──
// The user runs `claude setup-token` in a terminal and pastes the long-lived
// token (sk-ant-oat01-…). It authenticates against the Anthropic API with the
// oauth beta header — same messages format as the API-key path.

async function callClaudeOAuth(cfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LlmResponse> {
  const { system, rest } = splitSystem(messages)
  const body: any = {
    model: pickModel('claude-oauth', cfg),
    max_tokens: 4096,
    messages: rest.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content }))
  }
  if (system) body.system = system
  if (tools.length) {
    body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  }
  const data = await post('https://api.anthropic.com/v1/messages', body, {
    'Authorization': `Bearer ${cfg.apiKey}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'oauth-2025-04-20'
  }, signal)
  const text = data.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') ?? ''
  const toolCalls = (data.content ?? []).filter((b: any) => b.type === 'tool_use').map((b: any) => ({
    id: b.id, name: b.name, arguments: b.input ?? {}
  }))
  return { text, toolCalls }
}

function splitSystem(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  return { system, rest: messages.filter(m => m.role !== 'system') }
}

function safeJson(s: any): Record<string, unknown> {
  if (typeof s === 'object') return s ?? {}
  try { return JSON.parse(s) } catch { return {} }
}

export async function chat(aiCfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[] = [], localEndpoint?: string, egress: EgressContext = {}, signal?: AbortSignal): Promise<LlmResponse> {
  signal?.throwIfAborted()
  const gated = gate(aiCfg.provider, isLocalEndpoint(aiCfg.provider, localEndpoint ?? aiCfg.baseUrl), [...messages, { content: JSON.stringify(tools) }], { logFile: join(homedir(), ".keepmind", "egress.jsonl"), ...egressContext(), ...egress })
  messages = gated.slice(0, -1) as ChatMessage[]
  tools = JSON.parse(gated[gated.length - 1].content) as ToolDefinition[]
  const cfg = effectiveConfig(aiCfg, localEndpoint)
  messages = scrubForProvider(aiCfg, messages)
  switch (cfg.provider) {
    case 'anthropic':
      if (!cfg.apiKey) throw new Error('Anthropic API key missing')
      return callAnthropic(cfg, messages, tools, signal)
    case 'claude-oauth':
      if (!cfg.apiKey) throw new Error('Claude token missing — run `claude setup-token` and paste it')
      return callClaudeOAuth(cfg, messages, tools, signal)
    case 'codex':
      return callCodex(cfg, messages, tools, signal)
    case 'grok': {
      if (!cfg.apiKey) throw new Error('xAI API key missing (console.x.ai)')
      return callOpenAI({ ...cfg, baseUrl: cfg.baseUrl ?? 'https://api.x.ai/v1' }, messages, tools, signal)
    }
    case 'openai':
      if (!cfg.apiKey) throw new Error('OpenAI API key missing')
      return callOpenAI(cfg, messages, tools, signal)
    case 'gemini':
      if (!cfg.apiKey) throw new Error('Gemini API key missing')
      return callGemini(cfg, messages, tools, signal)
    case 'ollama':
      return callOllama(cfg, messages, tools, signal)
    default:
      throw new Error(`Unknown provider: ${cfg.provider}`)
  }
}

// Streaming variant for chat UI (SSE where supported; simple polling elsewhere)
export async function chatStream(
  aiCfg: AiProviderConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  localEndpoint?: string,
  egress: EgressContext = {}
): Promise<string> {
  messages = gate(aiCfg.provider, isLocalEndpoint(aiCfg.provider, localEndpoint ?? aiCfg.baseUrl), messages, { logFile: join(homedir(), ".keepmind", "egress.jsonl"), ...egressContext(), ...egress }) as ChatMessage[]
  const cfg = effectiveConfig(aiCfg, localEndpoint)
  messages = scrubForProvider(aiCfg, messages)
  // Ollama / llama-server streaming path
  if (cfg.provider === 'ollama' || aiCfg.provider === 'local') {
    const isOpenAI = aiCfg.provider === 'local' // llama-server OpenAI-compat path
    const base = aiCfg.provider === 'local'
      ? (localEndpoint ?? cfg.baseUrl ?? 'http://127.0.0.1:8765/v1')
      : (cfg.baseUrl ?? 'http://localhost:11434')
    const url = isOpenAI ? `${base.replace(/\/$/, '')}/chat/completions` : `${base.replace(/\/$/, '')}/api/chat`
    const body: any = isOpenAI
      ? {
          model: cfg.model ?? 'local',
          messages: messages.map(m => ({ role: m.role === 'tool' ? 'assistant' : m.role, content: m.content })),
          stream: true
        }
      : {
          model: cfg.model ?? MODELS.ollama[0],
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          stream: true
        }
    const res = await fetch(url, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify(body)
    })
    if (!res.ok || !res.body) throw new Error('Local stream failed')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let full = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value).split('\n').filter(Boolean)) {
        const trimmed = line.replace(/^data: /, '').trim()
        if (!trimmed || trimmed === '[DONE]') continue
        try {
          const j = JSON.parse(trimmed)
          const chunk = isOpenAI ? j.choices?.[0]?.delta?.content : j.message?.content
          if (chunk) { full += chunk; onDelta(chunk) }
        } catch { /* partial line */ }
      }
    }
    return full
  }

  const res = await chat(aiCfg, messages, [], localEndpoint, egress)
  if (res.text) onDelta(res.text)
  return res.text
}

// Live completion for the chat UI.
// Local llama.cpp and Ollama stream tokens as they arrive.
// Hosted providers return the finished text in one piece — no fake typewriter.
export async function chatLive(
  aiCfg: AiProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onDelta: (text: string) => void,
  localEndpoint?: string
): Promise<LlmResponse> {
  if (aiCfg.provider === 'local' || aiCfg.provider === 'ollama') {
    try {
      return await streamLocal(aiCfg, messages, tools, onDelta, localEndpoint)
    } catch { /* fall back to a blocking completion */ }
  }
  const res = await chat(aiCfg, messages, tools, localEndpoint)
  if (res.text && !res.toolCalls?.length) onDelta(res.text)
  return res
}

async function streamLocal(
  aiCfg: AiProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onDelta: (text: string) => void,
  localEndpoint?: string
): Promise<LlmResponse> {
  const cfg = effectiveConfig(aiCfg, localEndpoint)
  if (!isLocalEndpoint(aiCfg.provider, localEndpoint ?? cfg.baseUrl)) throw new Error('Local streaming requires a loopback endpoint')
  messages = scrubForProvider(aiCfg, messages)
  const isOpenAI = aiCfg.provider === 'local'
  const base = isOpenAI
    ? (localEndpoint ?? cfg.baseUrl ?? 'http://127.0.0.1:8765/v1')
    : (cfg.baseUrl ?? 'http://localhost:11434')
  const url = isOpenAI ? `${base.replace(/\/$/, '')}/chat/completions` : `${base.replace(/\/$/, '')}/api/chat`
  const body: Record<string, unknown> = isOpenAI
    ? {
        model: cfg.model ?? 'local',
        messages: messages.map(m => ({ role: m.role === 'tool' ? 'tool' : m.role, content: m.content, name: m.name })),
        stream: true,
        ...(tools.length ? {
          tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
          tool_choice: 'auto'
        } : {})
      }
    : {
        model: cfg.model ?? MODELS.ollama[0],
        messages: messages.map(m => ({ role: m.role === 'tool' ? 'tool' : m.role, content: m.content })),
        stream: true
      }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify(body)
  })
  if (!res.ok || !res.body) throw new Error('Local stream failed')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let pending = ''
  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>()
  const consume = (rawLine: string) => {
    const trimmed = rawLine.replace(/^data: /, '').trim()
    if (!trimmed || trimmed === '[DONE]') return
    const j = JSON.parse(trimmed)
    if (isOpenAI) {
      const delta = j.choices?.[0]?.delta ?? {}
      if (typeof delta.content === 'string' && delta.content) {
        full += delta.content
        onDelta(delta.content)
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0
        const cur = toolAcc.get(idx) ?? { id: '', name: '', arguments: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name += tc.function.name
        if (tc.function?.arguments) cur.arguments += tc.function.arguments
        toolAcc.set(idx, cur)
      }
    } else if (j.message?.content) {
      full += j.message.content
      onDelta(j.message.content)
    }
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { consume(line) } catch { /* partial json */ }
    }
  }
  if (pending.trim()) {
    try { consume(pending) } catch { /* ignore trailing junk */ }
  }
  const toolCalls = [...toolAcc.values()]
    .filter(t => t.name)
    .map(t => ({ id: t.id || `call_${t.name}`, name: t.name, arguments: safeJson(t.arguments) }))
  return { text: full, toolCalls }
}
