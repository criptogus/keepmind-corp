import { ipcMain, shell, BrowserWindow, app } from 'electron'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store, type Automation } from './store'
import { Brain } from './services/brain'
import { McpManager } from './services/mcp'
import { LocalLlm, LOCAL_MODELS, EMBED_MODELS } from './services/local-llm'
import { GitSync } from './services/sync'
import { AutomationScheduler, parseNaturalSchedule } from './services/automations'
import { AuthService } from './services/auth'
import { googleLogin } from './services/google-auth'
import type { RagService } from './services/rag'
import type { Planner } from './services/planner'
import * as llm from './services/llm'
import * as github from './services/github'
import { checkForUpdates, installUpdate, updaterStatus } from './services/updater'
import { listModels, deleteModel } from './services/models'
import { exportBrainConfig, ensureMcpServerScript } from './services/scaffold'
import { corpSyncNow } from './services/corp-sync'
import { reconcileCorpSyncSchedule } from './services/corp-sync-scheduler'
import { analyzeHealth, applyHealth } from './services/health'
import { createContinuityService } from './services/continuity'
import { MemoryIntelligence } from './services/memory-intelligence'
import { evolutionHints, installSkill, keepSkillCopy, listVaultSkills, loadSakNotes, loadSkillThreats, reviewVaultSkill, scanSkillThreats, searchRegistry, skillTrust, skillsSnapshot } from './services/skillsHub'
import { attachVaultCrypto, securityStatus, securityScan, securityConfigure, encryptAll, decryptAll, securityAiAlerts, type SecurityPatch } from './services/security'
import { isPlainObject, stripForbiddenKeys } from './safe-path'
import type { McpServerConfig } from './store'
import type { HookServer } from './services/hooks'

// ── IPC input validation ──
// Renderer is sandboxed, but a compromised renderer (XSS, malicious
// synced content) could still invoke these handlers. Validate shape and
// whitelist keys so patches can't smuggle arbitrary config or prototype
// pollution. Custom MCP commands remain user-authorized by design.

const AI_PROVIDERS = new Set(['local', 'anthropic', 'claude-oauth', 'openai', 'codex', 'gemini', 'grok', 'ollama'])
const MCP_KINDS = new Set(['whatsapp', 'telegram', 'postgres', 'custom'])
const CONFIG_SET_KEYS = new Set(['mcpServers', 'onboardingDone', 'background', 'autonomy'])
const MCP_PATCH_KEYS = new Set(['id', 'name', 'kind', 'enabled', 'command', 'args', 'env', 'sessionDir', 'permission'])
const MCP_PERMISSIONS = new Set(['allow', 'ask', 'block'])
const AUTOMATION_PATCH_KEYS = new Set(['name', 'instruction', 'kind', 'schedule', 'time', 'everyMinutes', 'weekday', 'enabled', 'mode'])
const AUTOMATION_KINDS = new Set(['brain', 'sleep', 'summary', 'librarian', 'evolve', 'enrich', 'review', 'security', 'skills', 'triage', 'briefing', 'escalate', 'compact', 'gaps'])
const AUTOMATION_SCHEDULES = new Set(['daily', 'interval', 'weekly'])

function bad(field: string): never {
  throw new Error(`invalid IPC payload: ${field}`)
}

function optStr(v: any, field: string, max = 8192): void {
  if (v !== undefined && (typeof v !== 'string' || v.length > max)) bad(field)
}

function reqStr(v: any, field: string, max = 8192): void {
  if (typeof v !== 'string' || !v.length || v.length > max) bad(field)
}

function validateMcpServerShape(s: any, partial: boolean): void {
  if (!isPlainObject(s)) bad('mcp server')
  if (partial) {
    for (const k of Object.keys(s)) if (!MCP_PATCH_KEYS.has(k)) bad(`mcp.${k}`)
  }
  if (!partial || s.id !== undefined) reqStr(s.id, 'mcp.id', 128)
  if (!partial || s.name !== undefined) reqStr(s.name, 'mcp.name', 256)
  if (!partial || s.kind !== undefined) {
    if (!MCP_KINDS.has(s.kind)) bad('mcp.kind')
  }
  if (s.enabled !== undefined && typeof s.enabled !== 'boolean') bad('mcp.enabled')
  if (s.permission !== undefined && !MCP_PERMISSIONS.has(s.permission)) bad('mcp.permission')
  optStr(s.command, 'mcp.command')
  optStr(s.sessionDir, 'mcp.sessionDir', 1024)
  if (s.args !== undefined) {
    if (!Array.isArray(s.args) || s.args.length > 64 || s.args.some((a: any) => typeof a !== 'string' || a.length > 2048)) bad('mcp.args')
  }
  if (s.env !== undefined) {
    if (!isPlainObject(s.env)) bad('mcp.env')
    const entries = Object.entries(s.env)
    if (entries.length > 64) bad('mcp.env size')
    for (const [k, v] of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string' || v.length > 8192) bad('mcp.env entry')
    }
  }
}

function validateAiPatch(p: any): void {
  if (!isPlainObject(p)) bad('ai patch')
  for (const k of Object.keys(p)) if (!['provider', 'apiKey', 'model', 'baseUrl'].includes(k)) bad(`ai.${k}`)
  if (p.provider !== undefined && !AI_PROVIDERS.has(p.provider)) bad('ai.provider')
  optStr(p.apiKey, 'ai.apiKey', 512)
  optStr(p.model, 'ai.model', 256)
  optStr(p.baseUrl, 'ai.baseUrl', 512)
}

function validateCorpSyncPatch(p: any): void {
  if (!isPlainObject(p)) bad('corpSync patch')
  for (const k of Object.keys(p)) {
    if (!['baseUrl', 'token', 'enabled', 'intervalMinutes', 'lastPullAt', 'lastPushAt', 'lastStatus'].includes(k)) bad(`corpSync.${k}`)
  }
  if (p.baseUrl !== undefined) optStr(p.baseUrl, 'corpSync.baseUrl', 2048)
  if (p.token !== undefined) optStr(p.token, 'corpSync.token', 2048)
  if (p.enabled !== undefined && typeof p.enabled !== 'boolean') bad('corpSync.enabled')
  if (p.intervalMinutes !== undefined && (typeof p.intervalMinutes !== 'number' || p.intervalMinutes < 0 || p.intervalMinutes > 10080)) bad('corpSync.intervalMinutes')
  for (const k of ['lastPullAt', 'lastPushAt', 'lastStatus'] as const) {
    if (p[k] !== undefined && p[k] !== null) optStr(p[k], `corpSync.${k}`, 512)
  }
}

function validateGithubPatch(p: any): void {
  if (!isPlainObject(p)) bad('github patch')
  for (const k of Object.keys(p)) {
    if (!['accessToken', 'refreshToken', 'login', 'repoOwner', 'repoName', 'repoUrl', 'defaultBranch', 'syncRoot', 'obfuscatePaths', 'encryptionEnabled'].includes(k)) bad(`github.${k}`)
  }
  for (const k of Object.keys(p)) {
    if (k === 'obfuscatePaths' || k === 'encryptionEnabled') {
      if (typeof p[k] !== 'boolean') bad(`github.${k}`)
    } else optStr(p[k], `github.${k}`, 2048)
  }
}

function validateLocalLlmPatch(p: any): void {
  if (!isPlainObject(p)) bad('localLlm patch')
  for (const k of Object.keys(p)) {
    if (!['modelId', 'modelPath', 'embedModelId'].includes(k)) {
      if (k === 'port') {
        if (typeof p.port !== 'number' || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535) bad('localLlm.port')
      } else if (k === 'downloadedBytes' || k === 'totalBytes') {
        if (typeof p[k] !== 'number' || !Number.isFinite(p[k]) || p[k] < 0) bad(`localLlm.${k}`)
      } else bad(`localLlm.${k}`)
    } else optStr(p[k], `localLlm.${k}`, 1024)
  }
}

function validateAutomationPatch(p: any): void {
  if (!isPlainObject(p)) bad('automation patch')
  for (const k of Object.keys(p)) if (!AUTOMATION_PATCH_KEYS.has(k)) bad(`automation.${k}`)
  optStr(p.name, 'automation.name', 256)
  optStr(p.instruction, 'automation.instruction', 8192)
  if (p.kind !== undefined && !AUTOMATION_KINDS.has(p.kind)) bad('automation.kind')
  if (p.schedule !== undefined && !AUTOMATION_SCHEDULES.has(p.schedule)) bad('automation.schedule')
  optStr(p.time, 'automation.time', 16)
  if (p.everyMinutes !== undefined && (typeof p.everyMinutes !== 'number' || p.everyMinutes < 1 || p.everyMinutes > 10080)) bad('automation.everyMinutes')
  if (p.weekday !== undefined && (typeof p.weekday !== 'number' || p.weekday < 0 || p.weekday > 6)) bad('automation.weekday')
  if (p.enabled !== undefined && typeof p.enabled !== 'boolean') bad('automation.enabled')
  if (p.mode !== undefined && p.mode !== 'auto' && p.mode !== 'approval') bad('automation.mode')
}

export function registerIpc(
  store: Store,
  brain: Brain,
  mcp: McpManager | null,
  localLlm: LocalLlm | null,
  sync: GitSync | null = null,
  automations: AutomationScheduler | null = null,
  auth: AuthService | null = null,
  rag: RagService | null = null,
  planner: Planner | null = null,
  laya: import('./services/laya').LayaService | null = null,
  hooks: HookServer | null = null
) {
  const continuity = createContinuityService(brain.getMemory())
  const intelligence = new MemoryIntelligence(brain.getMemory(), {
    configuration: () => ({ ai: store.get().ai, localModelId: store.get().localLlm.modelId }),
    localEndpoint: () => localLlm?.endpoint,
    ensureLocal: async modelId => {
      if (!localLlm) throw new Error('LOCAL_MODEL_UNAVAILABLE')
      await localLlm.ensureRunning(modelId)
    },
    onBenchmarkProgress: progress => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('brain:benchmarkProgress', progress)
    }
  })
  ipcMain.handle('brain:projectAnalyze', (_e, args: unknown) => {
    if (!isPlainObject(args)) bad('projectAnalyze.args')
    const input = args as Record<string, unknown>
    if (Object.keys(input).some(key => !['projectId', 'expectedRevision', 'maxSourceBytes'].includes(key))) bad('projectAnalyze.args')
    reqStr(input.projectId, 'projectAnalyze.projectId', 36)
    if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) bad('projectAnalyze.expectedRevision')
    if (input.maxSourceBytes !== undefined && (!Number.isSafeInteger(input.maxSourceBytes) || Number(input.maxSourceBytes) < 1024 || Number(input.maxSourceBytes) > 1048576)) bad('projectAnalyze.maxSourceBytes')
    return intelligence.projectAnalyze({ projectId: input.projectId as string, expectedRevision: input.expectedRevision as number, maxSourceBytes: input.maxSourceBytes as number | undefined })
  })
  ipcMain.handle('brain:answerBenchmarkRun', () => intelligence.runBenchmark())
  ipcMain.handle('brain:answerBenchmarkList', () => intelligence.listBenchmarks())
  ipcMain.handle('brain:answerBenchmarkCancel', () => intelligence.cancelBenchmark())
  ipcMain.handle('brain:continuity', (_e, action: unknown, args: unknown = {}) => {
    reqStr(action, 'continuity.action', 64)
    if (!isPlainObject(args)) bad('continuity.args')
    // The renderer is the human review surface. Agent/MCP callers use a
    // separate adapter that cannot select this authority through arguments.
    return brain.getMemory().withScope(() => continuity.dispatch(action as string, args as Record<string, unknown>, 'human'))
  })
  // ── Config ──
  ipcMain.handle('sync:unlock', async (_e, passphrase: unknown) => {
    reqStr(passphrase, 'passphrase', 4096)
    github.unlockSync(passphrase as string)
    try { await github.verifySyncPassphrase(store.get().github) }
    catch (error) { github.lockSync(); throw error }
    return { unlocked: true }
  })
  // Live activity stream — every journaled brain write reaches the renderer
  // instantly (graph heat, activity feed, stat counters).
  const sendAll = (channel: string, payload: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }
  brain.getMemory().onJournal = (entry) => {
    brain.touchGraph()
    sendAll('brain:activityPush', entry)
  }
  brain.onJob = (event) => sendAll('brain:job', event)
  if (automations) automations.onStatus = (event) => sendAll('brain:job', event)
  ipcMain.handle('config:get', () => store.get())
  ipcMain.handle('config:set', (_e, patch: any) => {
    if (!isPlainObject(patch)) bad('config patch')
    for (const k of Object.keys(patch)) if (!CONFIG_SET_KEYS.has(k)) bad(`config.${k}`)
    if (patch.onboardingDone !== undefined && typeof patch.onboardingDone !== 'boolean') bad('onboardingDone')
    if (patch.background !== undefined && typeof patch.background !== 'boolean') bad('background')
    if (patch.autonomy !== undefined && !['supervised', 'autopilot', 'autonomous'].includes(patch.autonomy)) bad('autonomy')
    if (patch.mcpServers !== undefined) {
      if (!Array.isArray(patch.mcpServers) || patch.mcpServers.length > 32) bad('mcpServers')
      for (const s of patch.mcpServers) validateMcpServerShape(s, false)
    }
    return store.set(stripForbiddenKeys(patch))
  })
  ipcMain.handle('config:updateAi', (_e, patch: any) => { validateAiPatch(patch); return store.updateAi(stripForbiddenKeys(patch)) })
  ipcMain.handle('config:updateLocalLlm', (_e, patch: any) => { validateLocalLlmPatch(patch); return store.updateLocalLlm(stripForbiddenKeys(patch)) })
  ipcMain.handle('config:updateGithub', (_e, patch: any) => {
    validateGithubPatch(patch)
    const res = store.updateGithub(stripForbiddenKeys(patch))
    // Switching obfuscation off requires re-pushing plaintext names before the
    // next pull, or stale remote versions would revert newer local edits.
    if (patch.obfuscatePaths === false) sync?.resyncAll()
    return res
  })
  ipcMain.handle('config:updateCorpSync', (_e, patch: any) => {
    validateCorpSyncPatch(patch)
    const cfg = store.updateCorpSync(stripForbiddenKeys(patch))
    reconcileCorpSyncSchedule(store)
    return cfg
  })
  ipcMain.handle('corpSync:now', async () => {
    const result = await corpSyncNow(store)
    reconcileCorpSyncSchedule(store)
    return result
  })
  ipcMain.handle('corpSync:status', () => store.get().corpSync ?? {})
  ipcMain.handle('config:updateMcp', (_e, id: string, patch: any) => {
    reqStr(id, 'mcp id', 128)
    validateMcpServerShape(patch, true)
    return store.updateMcpServer(id, stripForbiddenKeys(patch))
  })

  // ── AI providers ──
  ipcMain.handle('ai:providers', () => llm.listProviders())
  ipcMain.handle('ai:codexStatus', () => llm.codexStatus())
  ipcMain.handle('ai:test', async (e, provider: any) => {
    try {
      if (provider.provider === 'local' && localLlm) {
        const modelId = provider.model ?? store.get().localLlm.modelId ?? LOCAL_MODELS[1].id
        const ok = await localLlm.ensureReady(modelId)
        if (!ok) return { ok: false, error: 'Local model failed to start (download may be required)' }
      }
      const res = await llm.chat(provider, [
        { role: 'user', content: 'Reply with exactly: OK' }
      ], [], localLlm?.endpoint)
      return { ok: true, reply: res.text.slice(0, 100) }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })

  // ── Local LLM (bundled llama.cpp) ──
  ipcMain.handle('localllm:status', () => ({
    catalog: LOCAL_MODELS,
    serverDownloaded: localLlm?.isServerDownloaded() ?? false,
    running: localLlm?.isRunning ?? false,
    endpoint: localLlm?.endpoint,
    config: store.get().localLlm,
    currentModelDownloaded: localLlm ? localLlm.isModelDownloaded() : false,
    embedCatalog: EMBED_MODELS
  }))
  ipcMain.handle('localllm:downloadServer', async (e) => {
    if (!localLlm) throw new Error('no local llm')
    const win = BrowserWindow.fromWebContents(e.sender)
    const bin = await localLlm.downloadServer((pct) => {
      win?.webContents.send('localllm:progress', { kind: 'server', pct })
    })
    return { ok: true, bin }
  })
  ipcMain.handle('localllm:downloadModel', async (e, modelId: string) => {
    if (!localLlm) throw new Error('no local llm')
    const win = BrowserWindow.fromWebContents(e.sender)
    const path = await localLlm.downloadModel(modelId, (dl, total) => {
      win?.webContents.send('localllm:progress', { kind: 'model', modelId, downloaded: dl, total })
    })
    return { ok: true, path }
  })
  ipcMain.handle('localllm:ensure', async (_e, modelId?: string) => {
    if (!localLlm) throw new Error('no local llm')
    const id = modelId ?? store.get().localLlm.modelId ?? LOCAL_MODELS[1].id
    await localLlm.ensureReady(id)
    return { ok: true, endpoint: localLlm.endpoint }
  })
  ipcMain.handle('localllm:stop', async () => { await localLlm?.stop(); return true })

  // ── GitHub OAuth device flow ──
  ipcMain.handle('github:startDeviceFlow', async () => {
    const dc = await github.startDeviceFlow()
    return dc
  })
  ipcMain.handle('github:pollDeviceFlow', async (_e, deviceCode: any) => {
    const res = await github.pollDeviceFlow(deviceCode)
    if (res.status === 'success') {
      store.updateGithub({ accessToken: res.accessToken })
      // fetch login
      try {
        const me = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${res.accessToken}`, Accept: 'application/vnd.github+json' }
        }).then(r => r.json())
        store.updateGithub({ login: me.login })
      } catch { /* noop */ }
    }
    return res
  })
  ipcMain.handle('github:listRepos', async () => {
    const t = store.get().github.accessToken
    if (!t) return []
    try { return await github.listUserRepos(t) } catch { return [] }
  })
  ipcMain.handle('github:useRepo', async (_e, owner: string, repo: string) => {
    const t = store.get().github.accessToken
    if (!t) throw new Error('Not authenticated')
    const r = await github.getRepo(t, owner, repo)
    // Imported vaults usually have no memory/ subtree — mirror the whole repo
    // root instead so their existing layout becomes the brain. New repos and
    // vaults that already use memory/ keep the scoped prefix.
    const hasMemoryDir = (await github.listRepoFiles({ accessToken: t, repoOwner: owner, repoName: repo }, 'memory')).length > 0
    store.updateGithub({
      repoOwner: owner, repoName: repo,
      repoUrl: r.html_url, defaultBranch: r.default_branch,
      syncRoot: hasMemoryDir ? 'memory/' : ''
    })
    // teach agents the layout — only writes files the repo doesn't already have
    sync?.maybeScaffold().catch(() => {})
    return r
  })
  ipcMain.handle('github:createRepo', async (_e, name: string, description: string) => {
    const cfg = store.get().github
    if (!cfg.accessToken) throw new Error('Not authenticated')
    const repo = await github.createRepo(cfg.accessToken, name, description, true)
    const [owner] = repo.full_name.split('/')
    store.updateGithub({
      repoOwner: owner,
      repoName: repo.full_name.split('/')[1],
      repoUrl: repo.html_url,
      defaultBranch: repo.default_branch
    })
    // Push agent-onboarding files (AGENTS.md, .mcp.json, MCP server) into the repo
    sync?.maybeScaffold().catch(() => {})
    return repo
  })
  ipcMain.handle('github:pushMemory', async (_e, message: string) => {
    const gh = store.get().github
    if (!gh.accessToken || !gh.repoOwner) throw new Error('GitHub not connected')
    // push whole memory dir files via contents API
    const files = brain.getMemory().allRelFiles()
    for (const rel of files) {
      const content = brain.getMemory().read(rel)
      if (content === null) continue
      await github.pushFile(gh, `${gh.syncRoot ?? 'memory/'}${rel}`, content, message)
    }
    return { pushed: files.length }
  })

  // ── MCP ──
  ipcMain.handle('mcp:start', async (_e, id: string) => {
    const cfg = store.get().mcpServers.find(s => s.id === id)
    if (!cfg) throw new Error('Unknown server')
    if (!mcp) throw new Error('MCP manager not initialized')
    const tools = await mcp.startServer(cfg)
    return { tools: tools.map(t => t.name) }
  })
  ipcMain.handle('mcp:stop', async (_e, id: string) => {
    await mcp?.stopServer(id)
    return true
  })
  ipcMain.handle('mcp:status', () => ({
    running: mcp?.runningServers ?? [],
    allTools: mcp?.allTools().map(({ serverId, tool }) => ({ serverId, name: tool.name, description: tool.description })) ?? []
  }))
  ipcMain.handle('mcp:connectorQr', (_e, id: string) => {
    const srv = store.get().mcpServers.find(s => s.id === id)
    if (!srv) return null
    // legacy configs may lack sessionDir — fall back to the default locations
    const sessionDir = srv.sessionDir
      ?? (id === 'whatsapp' ? join(app.getPath('userData'), 'wa-session') : null)
      ?? (id === 'telegram' ? join(app.getPath('userData'), 'tg-session') : null)
    if (!sessionDir) return null
    const qrFile = join(sessionDir, 'qr.txt')
    if (!existsSync(qrFile)) return null
    const v = readFileSync(qrFile, 'utf8')
    if (v === 'CONNECTED') return { status: 'connected' }
    if (/^(LOGGED_OUT|ERROR|LOGIN_FAILED|QR_EXPIRED)$/.test(v)) return { status: 'error', code: v }
    return { status: 'qr', dataUrl: v }
  })
  ipcMain.handle('mcp:whatsappQr', () => {
    const qrFile = join(store.get().mcpServers.find(s => s.id === 'whatsapp')?.sessionDir ?? '', 'qr.txt')
    if (!existsSync(qrFile)) return null
    const v = readFileSync(qrFile, 'utf8')
    if (v === 'CONNECTED') return { status: 'connected' }
    if (v === 'LOGGED_OUT') return { status: 'logged_out' }
    return { status: 'qr', dataUrl: v }
  })
  ipcMain.handle('mcp:logs', () => mcpLogs)

  // ── Agent connections: paths/prompts for external LLMs & bots ──
  ipcMain.handle('connect:info', () => {
    const gh = store.get().github
    return {
      mcpScript: ensureMcpServerScript(),
      memoryDir: store.memoryDir,
      memoryRoot: store.get().github.syncRoot ?? 'memory/',
      repoUrl: gh.repoUrl ?? null,
      repoOwner: gh.repoOwner ?? null,
      repoName: gh.repoName ?? null
    }
  })

  // ── GitHub sync (bidirectional) ──
  ipcMain.handle('sync:status', () => sync?.status() ?? { connected: false, pending: 0, lastPull: null, lastPush: null, syncing: false })
  ipcMain.handle('sync:now', async () => sync ? sync.syncNow() : null)

  // ── Automations ──
  ipcMain.handle('automation:list', () => store.get().automations)
  ipcMain.handle('automation:parse', (_e, text: string) => parseNaturalSchedule(text))
  ipcMain.handle('automation:create', (_e, input: { instruction: string } & Partial<Automation>) => {
    const parsed = parseNaturalSchedule(input.instruction)
    const auto: Automation = {
      id: `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: input.name ?? parsed.name,
      instruction: input.instruction,
      kind: input.kind ?? parsed.kind,
      schedule: input.schedule ?? parsed.schedule,
      time: input.time ?? parsed.time,
      everyMinutes: input.everyMinutes ?? parsed.everyMinutes,
      weekday: input.weekday ?? parsed.weekday,
      enabled: input.enabled ?? true,
      createdAt: new Date().toISOString()
    }
    store.set({ automations: [...store.get().automations, auto] })
    return auto
  })
  ipcMain.handle('automation:update', (_e, id: string, patch: Partial<Automation>) => {
    reqStr(id, 'automation id', 128)
    validateAutomationPatch(patch)
    store.set({
      automations: store.get().automations.map(a => a.id === id ? { ...a, ...patch } : a)
    })
    return store.get().automations.find(a => a.id === id)
  })
  ipcMain.handle('automation:remove', (_e, id: string) => {
    store.set({ automations: store.get().automations.filter(a => a.id !== id) })
    return true
  })
  ipcMain.handle('automation:runNow', async (_e, id: string) => {
    const auto = store.get().automations.find(a => a.id === id)
    if (!auto) throw new Error('Unknown automation')
    // clicking "run now" IS the approval — bypass the approval queue
    if (automations) await automations.run(auto)
    store.set({
      automations: store.get().automations.map(a =>
        a.id === id ? { ...a, lastRunAt: new Date().toISOString() } : a)
    })
    return true
  })
  ipcMain.handle('automation:setWebhook', (_e, id: string, enabled: boolean) => {
    reqStr(id, 'automation id', 128)
    if (typeof enabled !== 'boolean') bad('webhook flag')
    const auto = automations?.setWebhook(id, enabled)
    if (!auto) throw new Error('Unknown automation')
    if (enabled) hooks?.ensureStarted()
    return {
      webhook: !!auto.webhook,
      url: auto.webhook && hooks ? `http://${hooks.host}:${hooks.port}/hook/${auto.id}` : null,
      token: auto.webhook ? auto.webhookToken : null
    }
  })
  ipcMain.handle('hooks:status', () => ({
    running: hooks?.running ?? false,
    host: hooks?.host ?? '127.0.0.1',
    port: hooks?.port ?? 4789,
    lan: !!store.get().hooks?.lan
  }))
  ipcMain.handle('hooks:setLan', (_e, lan: boolean) => {
    if (typeof lan !== 'boolean') bad('lan flag')
    store.set({ hooks: { lan } })
    hooks?.restart()
    return { lan }
  })
  ipcMain.handle('automation:pending', () => store.get().pendingApprovals)
  ipcMain.handle('automation:approve', async (_e, pendingId: string) => {
    const pending = store.get().pendingApprovals.find(p => p.id === pendingId)
    if (!pending) throw new Error('Unknown pending approval')
    const auto = store.get().automations.find(a => a.id === pending.automationId)
    store.set({ pendingApprovals: store.get().pendingApprovals.filter(p => p.id !== pendingId) })
    if (auto && automations) {
      await automations.run(auto)
      store.set({
        automations: store.get().automations.map(a =>
          a.id === auto.id ? { ...a, lastRunAt: new Date().toISOString() } : a)
      })
    }
    return true
  })
  ipcMain.handle('automation:reject', (_e, pendingId: string) => {
    store.set({ pendingApprovals: store.get().pendingApprovals.filter(p => p.id !== pendingId) })
    return true
  })

  // ── Brain ──
  const activeChats = new Map<number, { requestId: string; controller: AbortController }>()
  ipcMain.handle('brain:cancel', (e, requestId: string) => {
    reqStr(requestId, 'brain.cancel.requestId', 128)
    const active = activeChats.get(e.sender.id)
    if (!active || active.requestId !== requestId || active.controller.signal.aborted) return false
    active.controller.abort()
    return true
  })
  ipcMain.handle('brain:chat', async (e, agentId: string, message: string, requestId?: string) => {
    reqStr(agentId, 'brain.chat.agentId', 256)
    reqStr(message, 'brain.chat.message', 100000)
    if (requestId !== undefined) reqStr(requestId, 'brain.chat.requestId', 128)
    if (activeChats.has(e.sender.id)) throw new Error('CHAT_ALREADY_RUNNING: Já existe uma conversa em andamento nesta janela.')
    const id = requestId ?? randomUUID()
    const controller = new AbortController()
    const active = { requestId: id, controller }
    activeChats.set(e.sender.id, active)
    const destroyed = () => controller.abort()
    e.sender.once('destroyed', destroyed)
    const send = (channel: string, ...args: unknown[]) => { if (!e.sender.isDestroyed()) e.sender.send(channel, ...args) }
    try {
      brain.setActivitySource('chat')
      send('brain:job', { phase: 'start', name: 'Conversa' })
      const result = await brain.chat(agentId, message, (t) => {
        if (!controller.signal.aborted) send('brain:delta', t, id)
      }, (step) => {
        if (!controller.signal.aborted) send('brain:step', step, id)
      }, controller.signal)
      controller.signal.throwIfAborted()
      const summary = result.saved.length
        ? `Guardou ${result.saved.length} item(ns) na memória.`
        : 'Resposta registrada no log de hoje.'
      send('brain:job', { phase: 'done', name: 'Conversa', summary })
      return result
    } catch (err) {
      const error = controller.signal.aborted ? new Error('CHAT_CANCELLED: Geração interrompida. Ações já iniciadas podem terminar.') : err
      send('brain:job', { phase: 'error', name: 'Conversa', summary: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      e.sender.removeListener('destroyed', destroyed)
      if (activeChats.get(e.sender.id) === active) activeChats.delete(e.sender.id)
    }
  })
  ipcMain.handle('brain:ledger', (_e, limit?: number) => brain.ledger(typeof limit === 'number' ? limit : 40))
  ipcMain.handle('brain:search', (_e, query: string) => brain.hybridSearch(String(query ?? '')))
  ipcMain.handle('brain:facts', () => brain.factQueue())
  ipcMain.handle('brain:factAccept', (_e, id: string) => brain.acceptFact(String(id ?? '')))
  ipcMain.handle('brain:factDiscard', (_e, id: string) => brain.discardFact(String(id ?? '')))
  ipcMain.handle('brain:capture', (_e, text: string) => brain.captureFact(String(text ?? '')))
  ipcMain.handle('brain:correct', (_e, claim: string, correction: string) => brain.correctFact(String(claim ?? ''), String(correction ?? '')))
  ipcMain.handle('brain:eval', () => brain.evalStatus())
  ipcMain.handle('brain:cards', () => brain.dueCards(5))
  ipcMain.handle('brain:gradeCard', (_e, question: string, rating: string) => {
    const allowed = ['again', 'hard', 'good', 'easy'] as const
    if (!allowed.includes(rating as typeof allowed[number])) throw new Error('rating inválido')
    return brain.gradeCard(String(question ?? ''), rating as typeof allowed[number])
  })
  ipcMain.handle('brain:policy', () => brain.policy())
  ipcMain.handle('brain:policyApply', () => brain.applyLatestPolicy())
  ipcMain.handle('brain:insights', async () => { brain.setActivitySource('summary'); await brain.ensureProviderReady(); return brain.generateInsights() })
  ipcMain.handle('brain:dailySummary', async () => { brain.setActivitySource('summary'); await brain.ensureProviderReady(); return brain.dailySummary() })
  ipcMain.handle('brain:sleep', async () => { brain.setActivitySource('sleep'); await brain.ensureProviderReady(); return brain.sleep() })
  ipcMain.handle('brain:listSleep', () => brain.listSleepReports())
  ipcMain.handle('brain:memoryTiers', () => brain.memoryTierStats())
  ipcMain.handle('brain:listInsights', () => brain.listInsights())
  ipcMain.handle('brain:listSummaries', () => brain.listSummaries())
  ipcMain.handle('brain:listMemory', () => {
    const memory = brain.getMemory()
    return memory.allRelFiles().map(rel => ({ path: rel, content: memory.read(rel)!.slice(0, 4000) }))
  })
  ipcMain.handle('brain:briefing', (_e, force?: boolean) => brain.briefing(!!force))
  ipcMain.handle('brain:graph', () => brain.memoryGraph())
  ipcMain.handle('brain:memoryFile', (_e, rel: string) => {
    if (typeof rel !== 'string' || rel.length > 500) return null
    return brain.readMemoryFile(rel)
  })
  ipcMain.handle('brain:exportConfig', async () => {
    const gh = store.get().github
    if (!gh.accessToken || !gh.repoOwner) throw new Error('GitHub not configured')
    await exportBrainConfig(gh, store.get())
    return true
  })
  // ── Background / launch-at-login ──
  ipcMain.handle('app:launchAtLogin', () => ({
    enabled: store.get().launchAtLogin ?? false,
    openAtLogin: app.getLoginItemSettings().openAtLogin
  }))
  ipcMain.handle('app:setLaunchAtLogin', (_e, enabled: boolean) => {
    if (typeof enabled !== 'boolean') bad('launchAtLogin')
    app.setLoginItemSettings({ openAtLogin: enabled })
    return store.set({ launchAtLogin: enabled })
  })

  // ── Brain health: meta-insights about the second brain itself ──
  ipcMain.handle('brain:health', () => analyzeHealth(store, brain.getMemory()))
  ipcMain.handle('brain:healthApply', async (_e, recId: string) =>
    applyHealth(store, brain.getMemory(), automations, String(recId ?? ''))
  )

  // ── Skills bank: vault segments, SuperagentSkill registry, reviews ──
  const skillSlug = (slug: unknown) => {
    const s = String(slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!s || s.length > 80) throw new Error('invalid skill slug')
    return s
  }
  const skillPath = (rel: unknown) => {
    const s = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!s.endsWith('.md') || s.includes('..') || s.length > 240 || !/^[a-zA-Z0-9._/-]+$/.test(s)) {
      throw new Error('caminho de skill inválido')
    }
    return s
  }
  ipcMain.handle('brain:skills', () => skillsSnapshot(brain.getMemory()))
  ipcMain.handle('brain:skillInstall', (_e, slug: string) => installSkill(brain.getMemory(), skillSlug(slug)))
  ipcMain.handle('brain:skillKeep', (_e, rel: string) => keepSkillCopy(brain.getMemory(), skillPath(rel)))
  ipcMain.handle('brain:skillSearch', (_e, query: string, type?: string) => {
    const q = String(query ?? '').trim().slice(0, 80)
    if (q.length < 2) return []
    const kind = ['skill', 'playbook', 'soul', 'guardrail'].includes(String(type)) ? String(type) : undefined
    return searchRegistry(brain.getMemory(), q, kind)
  })
  ipcMain.handle('brain:skillReview', (_e, rel: string) => reviewVaultSkill(brain.getMemory(), skillPath(rel)))
  ipcMain.handle('brain:skillTrust', (_e, slug: string) => skillTrust(skillSlug(slug)))
  ipcMain.handle('brain:skillThreatScan', () => scanSkillThreats(brain.getMemory()))
  ipcMain.handle('brain:skillEvolve', async () => {
    const report = await brain.evolveSkills()
    const memory = brain.getMemory()
    return { report, hints: evolutionHints(listVaultSkills(memory), loadSakNotes(memory), loadSkillThreats(memory)) }
  })

  // ── Security: at-rest vault encryption + risk alerts ──
  ipcMain.handle('security:status', () => securityStatus(store, brain.getMemory()))
  ipcMain.handle('security:scan', () => securityScan(store, brain.getMemory()))
  ipcMain.handle('security:configure', async (_e, patch: any) => {
    if (!isPlainObject(patch)) bad('security patch')
    for (const k of Object.keys(patch)) {
      if (!['enabled', 'categories', 'passphrase'].includes(k)) bad(`security.${k}`)
    }
    if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') bad('security.enabled')
    if (patch.categories !== undefined && !Array.isArray(patch.categories)) bad('security.categories')
    if (patch.passphrase !== undefined && (typeof patch.passphrase !== 'string' || patch.passphrase.length > 256)) bad('security.passphrase')
    const p: SecurityPatch = {
      enabled: patch.enabled,
      categories: patch.categories?.map((c: any) => String(c)),
      passphrase: patch.passphrase
    }
    const status = await securityConfigure(store, brain.getMemory(), p)
    attachVaultCrypto(store, brain.getMemory())
    return status
  })
  ipcMain.handle('security:encryptAll', async () => {
    const n = await encryptAll(store, brain.getMemory())
    attachVaultCrypto(store, brain.getMemory())
    return { encrypted: n, status: await securityStatus(store, brain.getMemory()) }
  })
  ipcMain.handle('security:decryptAll', async () => {
    const n = await decryptAll(store, brain.getMemory())
    attachVaultCrypto(store, brain.getMemory())
    return { decrypted: n, status: await securityStatus(store, brain.getMemory()) }
  })
  ipcMain.handle('security:aiAlerts', () => securityAiAlerts(store, brain.getMemory(), localLlm))

  ipcMain.handle('brain:activity', (_e, limit?: number) => brain.getMemory().activity(limit ?? 200))

  // ── Auth (local accounts + Google sign-in) ──
  ipcMain.handle('auth:state', async () => {
    if (!auth) return { needsSetup: false, user: null }
    const token = store.get().auth.sessionToken
    const user = await auth.userByToken(token)
    return { needsSetup: !(await auth.hasUsers()), user }
  })
  ipcMain.handle('auth:register', async (_e, email: string, password: string, name: string) => {
    if (!auth) throw new Error('auth unavailable')
    const user = await auth.register(email, password, name)
    const token = await auth.createSession(user.id)
    store.set({ auth: { ...store.get().auth, sessionToken: token } })
    return user
  })
  ipcMain.handle('auth:login', async (_e, email: string, password: string) => {
    if (!auth) throw new Error('auth unavailable')
    const user = await auth.verifyPassword(email, password)
    if (!user) throw new Error('Invalid email or password')
    const token = await auth.createSession(user.id)
    store.set({ auth: { ...store.get().auth, sessionToken: token } })
    return user
  })
  ipcMain.handle('auth:logout', async () => {
    const token = store.get().auth.sessionToken
    if (auth && token) await auth.deleteSession(token)
    store.set({ auth: { ...store.get().auth, sessionToken: undefined } })
    return true
  })
  ipcMain.handle('auth:googleLogin', async () => {
    if (!auth) throw new Error('auth unavailable')
    const a = store.get().auth
    const profile = await googleLogin({ clientId: a.googleClientId ?? '', clientSecret: a.googleClientSecret ?? '' })
    const user = await auth.upsertGoogle(profile)
    const token = await auth.createSession(user.id)
    store.set({ auth: { ...store.get().auth, sessionToken: token } })
    return user
  })
  ipcMain.handle('auth:setGoogleCreds', (_e, clientId: string, clientSecret: string) => {
    store.set({ auth: { ...store.get().auth, googleClientId: clientId || undefined, googleClientSecret: clientSecret || undefined } })
    return true
  })

  // ── Semantic memory (local RAG) ──
  ipcMain.handle('rag:status', () => rag?.stats ?? { available: false, running: false, chunks: 0, embedded: 0 })
  ipcMain.handle('rag:setup', async (e, modelId: string) => {
    if (!localLlm) throw new Error('no local llm')
    const win = BrowserWindow.fromWebContents(e.sender)
    await localLlm.downloadEmbedModel(modelId, (dl, total) => {
      win?.webContents.send('localllm:progress', { kind: 'embed', downloaded: dl, total })
    })
    await localLlm.ensureEmbedRunning()
    if (rag) await rag.reindex()
    return rag?.stats ?? null
  })
  ipcMain.handle('rag:reindex', async () => rag ? rag.reindex() : null)

  // ── Model manager (disk inventory + delete) ──
  ipcMain.handle('models:list', () => {
    if (!localLlm) return []
    return listModels(localLlm, laya)
  })
  ipcMain.handle('models:delete', async (_e, key: string) => {
    if (!localLlm || typeof key !== 'string' || key.length > 80) throw new Error('invalid model key')
    const res = await deleteModel(localLlm, laya, key)
    pushMcpLog(`model deleted: ${key} (${(res.freedBytes / 1e6).toFixed(0)}MB)`)
    return res
  })

  // ── Laya decision engine (fast ONNX System-1) ──
  ipcMain.handle('laya:status', () => laya?.status() ?? { available: false, loaded: false, modelDir: '', downloaded: false })
  ipcMain.handle('laya:download', async (e) => {
    if (!laya) throw new Error('laya unavailable')
    const win = BrowserWindow.fromWebContents(e.sender)
    await laya.download((done, total, file) => {
      win?.webContents.send('laya:progress', { done, total, file })
    })
    return laya.status()
  })
  ipcMain.handle('laya:test', async () => {
    if (!laya) return null
    return laya.choose('The user prefers dark mode and concise answers.', 'What does the user prefer?', {
      dark: 'dark theme / dark mode',
      light: 'light theme',
      other: 'something else'
    })
  })

  // ── Window ──
  // ── Planner: notes / tasks / daily goals ──
  ipcMain.handle('notes:list', () => planner?.listNotes() ?? [])
  ipcMain.handle('notes:get', (_e, id: string) => planner?.getNote(id) ?? null)
  const ui = <T>(fn: () => T): T => { brain.setActivitySource('ui'); return fn() }
  ipcMain.handle('notes:save', (_e, id: string | null, title: string, body: string) => ui(() => planner?.saveNote(id, title, body)))
  ipcMain.handle('notes:delete', (_e, id: string) => ui(() => { planner?.deleteNote(id); return true }))

  ipcMain.handle('tasks:list', () => planner?.listTasks() ?? [])
  ipcMain.handle('tasks:add', (_e, title: string, opts?: any) => ui(() => planner?.addTask(title, opts)))
  ipcMain.handle('tasks:update', (_e, id: string, patch: any) => ui(() => planner?.updateTask(id, patch)))
  ipcMain.handle('tasks:toggle', (_e, id: string) => ui(() => planner?.toggleTask(id)))
  ipcMain.handle('tasks:delete', (_e, id: string) => ui(() => { planner?.deleteTask(id); return true }))

  ipcMain.handle('goals:get', (_e, date?: string) => planner?.getDailyGoals(date) ?? { date: '', items: [] })
  ipcMain.handle('goals:set', (_e, date: string, items: any[]) => ui(() => planner?.setDailyGoals(date, items)))
  ipcMain.handle('goals:add', (_e, date: string, text: string) => ui(() => planner?.addGoal(date, text)))
  ipcMain.handle('goals:toggle', (_e, date: string, index: number) => ui(() => planner?.toggleGoal(date, index)))
  ipcMain.handle('goals:remove', (_e, date: string, index: number) => ui(() => planner?.removeGoal(date, index)))
  ipcMain.handle('goals:suggest', async () => planner ? planner.suggestGoals() : [])

  // ── Auto-updater ──
  ipcMain.handle('updater:status', () => updaterStatus())
  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:install', () => installUpdate())

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'https:' || u.protocol === 'mailto:') return shell.openExternal(url)
    } catch { /* ignore */ }
    return false
  })

  reconcileCorpSyncSchedule(store)
}

const mcpLogs: string[] = []
export function pushMcpLog(line: string) {
  mcpLogs.push(line)
  if (mcpLogs.length > 500) mcpLogs.shift()
}
