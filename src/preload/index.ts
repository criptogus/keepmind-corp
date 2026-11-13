import { contextBridge, ipcRenderer } from 'electron'

const api = {
  securityConsent: (provider: string) => ipcRenderer.invoke('security:consent', provider),
  pipelineStatus: () => ipcRenderer.invoke('pipeline:status'),
  pipelineRefresh: () => ipcRenderer.invoke('pipeline:refresh'),
  pipelineEnqueue: (job: { platform: string; url: string; space: string }) => ipcRenderer.invoke('pipeline:enqueue', job),
  memorySecurityStatus: () => ipcRenderer.invoke('memorySecurity:status'),
  securitySetup: (passphrase: string) => ipcRenderer.invoke('security:setup', passphrase),
  securityUnlock: (credential?: { passphrase?: string; recoveryKey?: string }) => ipcRenderer.invoke('security:unlock', credential),
  securityLock: () => ipcRenderer.invoke('security:lock'),
  memorySecurityConfigure: (space: string, grants: string[], encryptAll: boolean) => ipcRenderer.invoke('memorySecurity:configure', space, grants, encryptAll),
  // config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: any) => ipcRenderer.invoke('config:set', patch),
  updateAi: (patch: any) => ipcRenderer.invoke('config:updateAi', patch),
  updateLocalLlm: (patch: any) => ipcRenderer.invoke('config:updateLocalLlm', patch),
  updateGithub: (patch: any) => ipcRenderer.invoke('config:updateGithub', patch),
  updateCorpSync: (patch: any) => ipcRenderer.invoke('config:updateCorpSync', patch),
  corpSyncNow: () => ipcRenderer.invoke('corpSync:now'),
  corpSyncStatus: () => ipcRenderer.invoke('corpSync:status'),
  updateMcp: (id: string, patch: any) => ipcRenderer.invoke('config:updateMcp', id, patch),

  // ai
  aiProviders: () => ipcRenderer.invoke('ai:providers'),
  aiCodexStatus: () => ipcRenderer.invoke('ai:codexStatus'),
  aiTest: (provider: any) => ipcRenderer.invoke('ai:test', provider),

  // github
  ghStartDeviceFlow: () => ipcRenderer.invoke('github:startDeviceFlow'),
  ghPollDeviceFlow: (dc: any) => ipcRenderer.invoke('github:pollDeviceFlow', dc),
  ghCreateRepo: (name: string, desc: string) => ipcRenderer.invoke('github:createRepo', name, desc),
  ghListRepos: () => ipcRenderer.invoke('github:listRepos'),
  ghUseRepo: (owner: string, repo: string) => ipcRenderer.invoke('github:useRepo', owner, repo),
  modelsList: () => ipcRenderer.invoke('models:list'),
  modelsDelete: (key: string) => ipcRenderer.invoke('models:delete', key),
  ghPushMemory: (msg: string) => ipcRenderer.invoke('github:pushMemory', msg),

  // local llm
  localLlmStatus: () => ipcRenderer.invoke('localllm:status'),
  localLlmDownloadServer: () => ipcRenderer.invoke('localllm:downloadServer'),
  localLlmDownloadModel: (id: string) => ipcRenderer.invoke('localllm:downloadModel', id),
  localLlmEnsure: (modelId?: string) => ipcRenderer.invoke('localllm:ensure', modelId),
  localLlmStop: () => ipcRenderer.invoke('localllm:stop'),
  onLocalLlmProgress: (cb: (p: any) => void) => {
    const handler = (_e: any, p: any) => cb(p)
    ipcRenderer.on('localllm:progress', handler)
    return () => { ipcRenderer.removeListener('localllm:progress', handler) }
  },

  // mcp
  mcpStart: (id: string) => ipcRenderer.invoke('mcp:start', id),
  mcpStop: (id: string) => ipcRenderer.invoke('mcp:stop', id),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  whatsappQr: () => ipcRenderer.invoke('mcp:whatsappQr'),
  connectorQr: (id: string) => ipcRenderer.invoke('mcp:connectorQr', id),
  mcpLogs: () => ipcRenderer.invoke('mcp:logs'),
  connectInfo: () => ipcRenderer.invoke('connect:info'),

  // auth
  authState: () => ipcRenderer.invoke('auth:state'),
  authRegister: (email: string, password: string, name: string) => ipcRenderer.invoke('auth:register', email, password, name),
  authLogin: (email: string, password: string) => ipcRenderer.invoke('auth:login', email, password),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authGoogleLogin: () => ipcRenderer.invoke('auth:googleLogin'),
  authSetGoogleCreds: (clientId: string, clientSecret: string) => ipcRenderer.invoke('auth:setGoogleCreds', clientId, clientSecret),

  // rag
  ragStatus: () => ipcRenderer.invoke('rag:status'),
  ragSetup: (modelId: string) => ipcRenderer.invoke('rag:setup', modelId),
  ragReindex: () => ipcRenderer.invoke('rag:reindex'),

  // laya decision engine
  layaStatus: () => ipcRenderer.invoke('laya:status'),
  layaDownload: () => ipcRenderer.invoke('laya:download'),
  layaTest: () => ipcRenderer.invoke('laya:test'),
  onLayaProgress: (cb: (p: any) => void) => {
    const handler = (_e: any, p: any) => cb(p)
    ipcRenderer.on('laya:progress', handler)
    return () => { ipcRenderer.removeListener('laya:progress', handler) }
  },

  // sync
  unlockSync: (passphrase: string) => ipcRenderer.invoke('sync:unlock', passphrase),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncNow: () => ipcRenderer.invoke('sync:now'),

  // automations
  automationList: () => ipcRenderer.invoke('automation:list'),
  automationParse: (text: string) => ipcRenderer.invoke('automation:parse', text),
  automationCreate: (input: any) => ipcRenderer.invoke('automation:create', input),
  automationUpdate: (id: string, patch: any) => ipcRenderer.invoke('automation:update', id, patch),
  automationRemove: (id: string) => ipcRenderer.invoke('automation:remove', id),
  automationRunNow: (id: string) => ipcRenderer.invoke('automation:runNow', id),
  automationPending: () => ipcRenderer.invoke('automation:pending'),
  automationApprove: (id: string) => ipcRenderer.invoke('automation:approve', id),
  automationReject: (id: string) => ipcRenderer.invoke('automation:reject', id),
  automationSetWebhook: (id: string, enabled: boolean) => ipcRenderer.invoke('automation:setWebhook', id, enabled),
  hooksStatus: () => ipcRenderer.invoke('hooks:status'),
  hooksSetLan: (lan: boolean) => ipcRenderer.invoke('hooks:setLan', lan),

  // brain
  brainChat: (agentId: string, message: string, requestId?: string) => ipcRenderer.invoke('brain:chat', agentId, message, requestId),
  brainCancel: (requestId: string): Promise<boolean> => ipcRenderer.invoke('brain:cancel', requestId),
  brainInsights: () => ipcRenderer.invoke('brain:insights'),
  brainDailySummary: () => ipcRenderer.invoke('brain:dailySummary'),
  brainSleep: () => ipcRenderer.invoke('brain:sleep'),
  brainListSleep: () => ipcRenderer.invoke('brain:listSleep'),
  brainMemoryTiers: () => ipcRenderer.invoke('brain:memoryTiers'),
  brainListInsights: () => ipcRenderer.invoke('brain:listInsights'),
  brainListSummaries: () => ipcRenderer.invoke('brain:listSummaries'),
  brainListMemory: () => ipcRenderer.invoke('brain:listMemory'),
  brainGraph: () => ipcRenderer.invoke('brain:graph'),
  brainBriefing: (force?: boolean) => ipcRenderer.invoke('brain:briefing', force),
  brainMemoryFile: (rel: string) => ipcRenderer.invoke('brain:memoryFile', rel),
  brainActivity: (limit?: number) => ipcRenderer.invoke('brain:activity', limit),
  brainLedger: (limit?: number) => ipcRenderer.invoke('brain:ledger', limit),
  brainSearch: (query: string) => ipcRenderer.invoke('brain:search', query),
  brainFacts: () => ipcRenderer.invoke('brain:facts'),
  brainFactAccept: (id: string) => ipcRenderer.invoke('brain:factAccept', id),
  brainFactDiscard: (id: string) => ipcRenderer.invoke('brain:factDiscard', id),
  brainCapture: (text: string) => ipcRenderer.invoke('brain:capture', text),
  brainCorrect: (claim: string, correction: string) => ipcRenderer.invoke('brain:correct', claim, correction),
  brainEval: () => ipcRenderer.invoke('brain:eval'),
  continuity: (action: string, args: Record<string, unknown> = {}): Promise<any> => ipcRenderer.invoke('brain:continuity', action, args),
  crm: (action: string, args: Record<string, unknown> = {}): Promise<any> => ipcRenderer.invoke('brain:crm', action, args),
  projectAnalyze: (args: { projectId: string; expectedRevision: number; maxSourceBytes?: number }): Promise<any> => ipcRenderer.invoke('brain:projectAnalyze', args),
  answerBenchmarkRun: (): Promise<any> => ipcRenderer.invoke('brain:answerBenchmarkRun'),
  answerBenchmarkList: (): Promise<any[]> => ipcRenderer.invoke('brain:answerBenchmarkList'),
  answerBenchmarkCancel: (): Promise<boolean> => ipcRenderer.invoke('brain:answerBenchmarkCancel'),
  onBenchmarkProgress: (cb: (progress: { completed: number; total: number; calls: number; space: string }) => void) => {
    const handler = (_event: unknown, progress: { completed: number; total: number; calls: number; space: string }) => cb(progress)
    ipcRenderer.on('brain:benchmarkProgress', handler)
    return () => ipcRenderer.removeListener('brain:benchmarkProgress', handler)
  },
  onCapture: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('brain:capture', handler)
    return () => { ipcRenderer.removeListener('brain:capture', handler) }
  },
  brainCards: () => ipcRenderer.invoke('brain:cards'),
  brainGradeCard: (question: string, rating: string) => ipcRenderer.invoke('brain:gradeCard', question, rating),
  brainPolicy: () => ipcRenderer.invoke('brain:policy'),
  brainPolicyApply: () => ipcRenderer.invoke('brain:policyApply'),
  onJob: (cb: (e: any) => void) => {
    const handler = (_e: any, entry: any) => cb(entry)
    ipcRenderer.on('brain:job', handler)
    return () => { ipcRenderer.removeListener('brain:job', handler) }
  },
  onBrainStep: (cb: (step: string, requestId?: string) => void) => {
    const handler = (_e: any, step: string, requestId?: string) => cb(step, requestId)
    ipcRenderer.on('brain:step', handler)
    return () => { ipcRenderer.removeListener('brain:step', handler) }
  },
  onActivityPush: (cb: (e: any) => void) => {
    const handler = (_e: any, entry: any) => cb(entry)
    ipcRenderer.on('brain:activityPush', handler)
    return () => { ipcRenderer.removeListener('brain:activityPush', handler) }
  },
  brainExportConfig: () => ipcRenderer.invoke('brain:exportConfig'),
  brainHealth: () => ipcRenderer.invoke('brain:health'),
  brainHealthApply: (recId: string) => ipcRenderer.invoke('brain:healthApply', recId),
  brainSkills: () => ipcRenderer.invoke('brain:skills'),
  brainSkillInstall: (slug: string) => ipcRenderer.invoke('brain:skillInstall', slug),
  brainSkillKeep: (path: string) => ipcRenderer.invoke('brain:skillKeep', path),
  brainSkillSearch: (query: string, type?: string) => ipcRenderer.invoke('brain:skillSearch', query, type),
  brainSkillReview: (path: string) => ipcRenderer.invoke('brain:skillReview', path),
  brainSkillTrust: (slug: string) => ipcRenderer.invoke('brain:skillTrust', slug),
  brainSkillThreatScan: () => ipcRenderer.invoke('brain:skillThreatScan'),
  brainSkillEvolve: () => ipcRenderer.invoke('brain:skillEvolve'),
  securityStatus: () => ipcRenderer.invoke('security:status'),
  securityScan: () => ipcRenderer.invoke('security:scan'),
  securityConfigure: (patch: any) => ipcRenderer.invoke('security:configure', patch),
  securityEncryptAll: () => ipcRenderer.invoke('security:encryptAll'),
  securityDecryptAll: () => ipcRenderer.invoke('security:decryptAll'),
  securityAiAlerts: () => ipcRenderer.invoke('security:aiAlerts'),
  appLaunchAtLogin: () => ipcRenderer.invoke('app:launchAtLogin'),
  appSetLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke('app:setLaunchAtLogin', enabled),
  onBrainDelta: (cb: (t: string, requestId?: string) => void) => {
    const handler = (_e: any, t: string, requestId?: string) => cb(t, requestId)
    ipcRenderer.on('brain:delta', handler)
    return () => { ipcRenderer.removeListener('brain:delta', handler) }
  },

  // planner: notes / tasks / goals
  notesList: () => ipcRenderer.invoke('notes:list'),
  notesGet: (id: string) => ipcRenderer.invoke('notes:get', id),
  notesSave: (id: string | null, title: string, body: string) => ipcRenderer.invoke('notes:save', id, title, body),
  notesDelete: (id: string) => ipcRenderer.invoke('notes:delete', id),

  tasksList: () => ipcRenderer.invoke('tasks:list'),
  tasksAdd: (title: string, opts?: any) => ipcRenderer.invoke('tasks:add', title, opts),
  tasksUpdate: (id: string, patch: any) => ipcRenderer.invoke('tasks:update', id, patch),
  tasksToggle: (id: string) => ipcRenderer.invoke('tasks:toggle', id),
  tasksDelete: (id: string) => ipcRenderer.invoke('tasks:delete', id),

  goalsGet: (date?: string) => ipcRenderer.invoke('goals:get', date),
  goalsAdd: (date: string, text: string) => ipcRenderer.invoke('goals:add', date, text),
  goalsToggle: (date: string, index: number) => ipcRenderer.invoke('goals:toggle', date, index),
  goalsRemove: (date: string, index: number) => ipcRenderer.invoke('goals:remove', date, index),
  goalsSuggest: () => ipcRenderer.invoke('goals:suggest'),

  // updater
  updaterStatus: () => ipcRenderer.invoke('updater:status'),
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  onUpdaterEvent: (cb: (e: any) => void) => {
    const handler = (_e: any, ev: any) => cb(ev)
    ipcRenderer.on('updater:event', handler)
    return () => { ipcRenderer.removeListener('updater:event', handler) }
  },

  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
}

export type SecondBrainApi = typeof api
contextBridge.exposeInMainWorld('sb', api)
