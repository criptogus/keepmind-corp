// Browser preview shim — when the renderer runs outside Electron (plain
// browser at localhost:5173), window.sb doesn't exist. Provide a demo stub so
// the UI is explorable. All mutating calls are no-ops.

const demoConfig = {
  onboardingDone: true,
  ai: { provider: 'local', model: 'qwen2.5-3b' },
  localLlm: { modelId: 'qwen2.5-3b' },
  github: { repoUrl: 'https://github.com/voce/keepmind', login: 'voce' },
  mcpServers: [
    { id: 'whatsapp', name: 'WhatsApp', kind: 'whatsapp', enabled: true },
    { id: 'telegram', name: 'Telegram', kind: 'telegram', enabled: false },
    { id: 'postgres', name: 'Postgres (read-only)', kind: 'postgres', enabled: false }
  ],
  agents: [
    { id: 'brain', name: 'KeepMind', emoji: '🧠', persona: 'You are the user\'s second brain.', builtin: true }
  ],
  automations: [
    { id: 'auto_demo1', name: 'Morning briefing', instruction: 'every day at 8am summarize yesterday\'s activity', kind: 'summary', schedule: 'daily', time: '08:00', enabled: true, createdAt: '2026-11-01T00:00:00Z', lastRunAt: '2026-11-05T08:00:00Z' }
  ]
}

const noop = async () => ({})
const noopVoid = async () => undefined

const demoMemory = [
  { path: 'inbox/2026-11-05.md', content: '# 2026-11-05\n\n## Chat with Warren Buffett\n\n**You:** how to think long-term?\n\n**Warren:** The short-term market is a voting machine; the long-term market is a weighing machine. Build something that still exists in 10 years.\n' },
  { path: 'insights/2026-11-05.md', content: '# Insights — 2026-11-05\n\n- 📌 You mentioned "focus" 3x this week — consider protecting deep-work blocks\n- ⚠️ No messages answered in 2 days on connected WhatsApp\n- 🎯 Q4 goal: review your circles of competence yearly' },
  { path: 'summaries/2026-11-04.md', content: '# Daily summary — 2026-11-04\n\n- Product-focused day; 2 important decisions made\n- Warren Buffett suggested reviewing time allocation\n- Tomorrow: writing block suggested by the brain' }
]

let deltaCb: ((t: string) => void) | null = null

// ── Demo state for planner features (notes / tasks / goals) ──
const todayStr = () => new Date().toISOString().slice(0, 10)
const demoNotes: any[] = [
  { id: 'reading-list', title: 'Reading list', body: '- The Almanack of Naval Ravikant\n- Thinking in Systems\n- Deep Work', updated: '2026-11-05T10:00:00Z' },
  { id: 'gift-ideas', title: 'Gift ideas for mom', body: '1. Photo book of grandkids\n2. That jazz box set she mentioned', updated: '2026-11-04T18:30:00Z' }
]
const demoTasks: any[] = [
  { id: 't1', title: 'Reply to accountant about invoices', done: false, priority: 'high', due: todayStr(), created: '2026-11-05T09:00:00Z', notes: '' },
  { id: 't2', title: 'Book dentist appointment', done: false, priority: 'normal', due: null, created: '2026-11-05T09:05:00Z', notes: '' },
  { id: 't3', title: 'Renew domain superbrains.dev', done: true, priority: 'normal', due: null, created: '2026-11-01T09:00:00Z', notes: '' }
]
let demoSkillItems = [
  {
    file: 'research.md', path: 'skills/research.md', group: 'keepmind', segment: 'KeepMind', category: 'research',
    title: 'Research before answering', ageDays: 4, uses: 8, mentions: 2, kind: 'skill',
    slug: 'research', excerpt: 'Before stating a fact, search memory.'
  },
  {
    file: 'seo-brief.md', path: 'skills/seo-brief.md', group: 'keepmind', segment: 'KeepMind', category: 'marketing',
    title: 'SEO brief', ageDays: 9, uses: 5, mentions: 1, kind: 'skill',
    slug: 'seo-brief', excerpt: 'Draft a search brief before a campaign page.'
  },
  {
    file: 'composio-toolkits.md', path: 'skills/composio-toolkits.md', group: 'keepmind', segment: 'SuperagentSkill', category: 'automation',
    title: 'Composio toolkits', ageDays: 2, uses: 3, mentions: 1, kind: 'skill',
    slug: 'composio-toolkits', excerpt: 'Run an action in a connected app when the user asks for a tool.'
  },
  {
    file: 'SKILL.md', path: 'agents/camaha/composio-toolkits/SKILL.md', group: 'camaha', segment: 'camaha', category: 'automation',
    title: 'Composio toolkits', ageDays: 20, uses: 0, mentions: 0, kind: 'skill',
    slug: 'composio-toolkits', excerpt: 'Run an action in a connected app when the user asks for a tool.'
  },
  {
    file: 'code-review.md', path: 'skills/code-review.md', group: 'keepmind', segment: 'KeepMind', category: 'development',
    title: 'Code review', ageDays: 1, uses: 6, mentions: 0, kind: 'skill',
    slug: 'code-review', excerpt: 'Review a diff for bugs before it ships.'
  },
  {
    file: 'threat-model.md', path: 'skills/threat-model.md', group: 'keepmind', segment: 'KeepMind', category: 'cybersec',
    title: 'Threat model', ageDays: 30, uses: 0, mentions: 0, kind: 'skill',
    slug: 'threat-model', excerpt: 'List what an attacker can reach before a launch.'
  }
]
let demoSkillHints = [
  {
    path: 'skills/composio-toolkits.md', title: 'Composio toolkits', segment: 'SuperagentSkill', kind: 'duplicate' as const,
    paths: ['skills/composio-toolkits.md', 'agents/camaha/composio-toolkits/SKILL.md'],
    sentence: '“Composio toolkits” is in 2 files: skills/composio-toolkits.md · agents/camaha/composio-toolkits/SKILL.md.'
  },
  {
    path: 'skills/research.md', title: 'Research before answering', segment: 'KeepMind', kind: 'use' as const,
    sentence: 'Used 10 times and still unscored. Score it on SuperagentSkill before rewriting.'
  },
  {
    path: 'skills/threat-model.md', title: 'Threat model', segment: 'KeepMind', kind: 'idle' as const,
    sentence: 'No use in 30 days. It is not showing up in chats, or it can leave the vault.'
  }
]

let demoFacts = [
  { id: 'p-demo', text: 'The private repo is the source of memory.', since: todayStr(), origin: 'sleep', source: 'sono', previous: '' }
]
const demoGoals: any[] = [
  { text: '90 minutes of deep work on the product', done: false },
  { text: 'Call mom', done: true },
  { text: 'Review tomorrow\'s calendar', done: false }
]
const demo = {
  // Preview is read-only: never report a CRM write or delivery as successful.
  crm: async (action: string) => {
    if (action !== 'snapshot') throw new Error('Relacionamentos estão disponíveis somente para leitura nesta prévia.')
    return { schemaVersion: 1, revision: 0, space: 'demo', contacts: [], interactions: [], commitments: [], opportunities: [], drafts: [], settings: { commercialEnabled: false, autoPrepare: true, allowAutomaticSend: false, syncConnectedChannels: false, followUpDays: 7, dailySendLimit: 10 }, insights: [{ type: 'preview', text: 'Prévia de relacionamentos: alterações não são salvas aqui.' }], duplicates: [], metrics: {}, merges: [], capabilities: { canWrite: false, canSend: false, canSync: false, canConfigure: false, boards: [{ id: 'personal', label: 'Prévia' }], activeBoard: 'personal' } }
  },
  getConfig: async () => demoConfig,
  setConfig: noop,
  updateAi: async (p: any) => ({ ...demoConfig.ai, ...p }),
  updateLocalLlm: noop,
  updateGithub: noop,
  updateMcp: noop,

  aiProviders: async () => [
    { id: 'local', name: 'Local (built-in, offline)', models: ['qwen2.5-3b', 'smollm2-1.7b', 'llama3.2-3b', 'qwen2.5-7b'], needsKey: false },
    { id: 'anthropic', name: 'Claude (Anthropic)', models: ['claude-sonnet-4-5'], needsKey: true },
    { id: 'openai', name: 'OpenAI', models: ['gpt-4o'], needsKey: true },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-pro'], needsKey: true },
    { id: 'ollama', name: 'Ollama (local)', models: ['llama3.1'], needsKey: false }
  ],
  aiTest: async () => ({ ok: true, reply: 'OK (demo)' }),

  ghStartDeviceFlow: async () => ({ device_code: 'demo', user_code: 'DEMO-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }),
  ghPollDeviceFlow: async () => null,
  ghCreateRepo: async () => ({ full_name: 'voce/second-brain', html_url: 'https://github.com/voce/keepmind', clone_url: '', default_branch: 'main' }),
  ghListRepos: async () => [],
  ghUseRepo: async () => ({ full_name: 'voce/repo' }),
  ghPushMemory: async () => ({ pushed: 12 }),

  localLlmStatus: async () => ({
    catalog: [
      { id: 'smollm2-1.7b', label: 'SmolLM2 1.7B', sizeGB: 1.1, description: 'Smallest option' },
      { id: 'qwen2.5-3b', label: 'Qwen2.5 3B', sizeGB: 2.0, description: 'Recommended default' },
      { id: 'llama3.2-3b', label: 'Llama 3.2 3B', sizeGB: 2.0, description: 'Meta small model' },
      { id: 'qwen2.5-7b', label: 'Qwen2.5 7B', sizeGB: 4.7, description: 'Best quality' }
    ],
    serverDownloaded: true, running: true, endpoint: 'http://127.0.0.1:8765/v1',
    config: { modelId: 'qwen2.5-3b' }, currentModelDownloaded: true,
    embedCatalog: [
      { id: 'bge-small', label: 'BGE Small EN v1.5', sizeMB: 64, dims: 384 },
      { id: 'nomic-embed', label: 'Nomic Embed Text v1.5', sizeMB: 85, dims: 768 }
    ]
  }),
  localLlmDownloadServer: noop,
  localLlmDownloadModel: noop,
  localLlmEnsure: async () => ({ ok: true, endpoint: 'http://127.0.0.1:8765/v1' }),
  localLlmStop: noop,
  onLocalLlmProgress: () => () => {},

  mcpStart: async () => ({ tools: ['whatsapp_status', 'whatsapp_qr', 'whatsapp_send', 'whatsapp_messages'] }),
  mcpStop: noopVoid,
  mcpStatus: async () => ({
    running: ['whatsapp'],
    allTools: [
      { serverId: 'whatsapp', name: 'whatsapp_status', description: 'Check connection' },
      { serverId: 'whatsapp', name: 'whatsapp_send', description: 'Send message' },
      { serverId: 'whatsapp', name: 'whatsapp_messages', description: 'List messages' }
    ]
  }),
  whatsappQr: async () => ({ status: 'qr', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }),
  mcpLogs: async () => [],

  brainChat: async (agentId: string, message: string) => {
    // emit fake streaming
    const text = `🧠 **KeepMind (demo)**\n\nGot your message: "${message}"\n\nIn the real app, I would query your memory, the MCP connectors, and reply with full context.`
    // simulate streaming deltas
    for (const w of text.split(/(\s+)/)) {
      deltaCb?.(w)
      await new Promise(r => setTimeout(r, 15))
    }
    return text
  },
  onBrainDelta: (cb: (t: string) => void) => {
    deltaCb = cb
    return () => { deltaCb = null }
  },
  brainInsights: async () => ['💡 Demo insight'],
  brainDailySummary: async () => 'Demo summary',
  brainListInsights: async () => [
    { date: '2026-11-05', content: '# Insights — 2026-11-05\n\n- 📌 You mentioned "focus" 3x this week — consider protecting deep-work blocks\n- ⚠️ No messages answered in 2 days\n- 🎯 Review your circles of competence' }
  ],
  brainListSummaries: async () => [
    { date: '2026-11-04', content: '# Daily summary — 2026-11-04\n\n- Product-focused day; 2 important decisions made\n- Warren suggested reviewing time allocation\n- Tomorrow: writing block suggested by the brain' }
  ],
  brainListMemory: async () => demoMemory,
  brainSleep: async () => ({ report: '(demo sleep report)', consolidated: 0 }),
  brainListSleep: async () => [
    { date: '2026-11-05', content: '# Sleep cycle — 2026-11-05\n\n### 1. Working\n- Deep work blocks on product\n\n### 2. Can improve\n- More delegation\n\n### 3. Not working → fix\n- Unanswered messages pile up\n\n### 4. Stop\n- Checking phone during focus blocks\n\n### 5. Start\n- Weekly review ritual\n\n### Tonight\'s commitments\n- Block 2h tomorrow morning' }
  ],
  brainMemoryTiers: async () => ({ shortTerm: 3, mediumTerm: 1, longTerm: 8, sleepCycles: 2 }),

  unlockSync: async () => ({ unlocked: true }),
  syncStatus: async () => ({ connected: true, pending: 0, lastPull: '2026-11-05T12:00:00Z', lastPush: '2026-11-05T12:00:01Z', syncing: false }),
  syncNow: async () => ({ connected: true, pending: 0, lastPull: '2026-11-05T12:00:00Z', lastPush: '2026-11-05T12:00:01Z', syncing: false }),

  automationList: async () => demoConfig.automations,
  automationParse: async (text: string) => ({
    kind: 'brain', schedule: 'daily', time: '08:00',
    label: 'every day at 08:00 (demo)', name: text.slice(0, 40)
  }),
  automationCreate: async (input: any) => ({ id: 'auto_new', ...input, enabled: true, createdAt: new Date().toISOString() }),
  automationUpdate: async (id: string, patch: any) => ({ ...demoConfig.automations[0], ...patch }),
  automationRemove: async () => true,
  automationRunNow: async () => true,

  authState: async () => ({ needsSetup: false, user: { id: 1, email: 'demo@secondbrain.local', name: 'Demo User' } }),
  authRegister: async () => ({ id: 1, email: 'demo@secondbrain.local', name: 'Demo' }),
  authLogin: async () => ({ id: 1, email: 'demo@secondbrain.local', name: 'Demo' }),
  authLogout: async () => true,
  authGoogleLogin: async () => ({ id: 1, email: 'demo@secondbrain.local', name: 'Demo' }),
  authSetGoogleCreds: async () => true,
  ragStatus: async () => ({ available: true, running: true, modelId: 'bge-small', chunks: 42, embedded: 42 }),
  ragSetup: async () => ({ available: true, running: true, chunks: 42, embedded: 42 }),
  ragReindex: async () => ({ chunks: 42, embedded: 42 }),

  // planner demo
  notesList: async () => demoNotes,
  notesGet: async (id: string) => demoNotes.find(n => n.id === id) ?? null,
  notesSave: async (id: string | null, title: string, body: string) => {
    const n = { id: id ?? `n${Date.now()}`, title, body, updated: new Date().toISOString() }
    const i = demoNotes.findIndex(x => x.id === n.id)
    i >= 0 ? demoNotes[i] = n : demoNotes.unshift(n)
    return n
  },
  notesDelete: async (id: string) => { const i = demoNotes.findIndex(n => n.id === id); if (i >= 0) demoNotes.splice(i, 1); return true },

  tasksList: async () => demoTasks,
  tasksAdd: async (title: string, opts: any = {}) => {
    const t = { id: `t${Date.now()}`, title, done: false, priority: opts.priority ?? 'normal', due: opts.due ?? null, created: new Date().toISOString(), notes: opts.notes ?? '' }
    demoTasks.unshift(t); return t
  },
  tasksUpdate: async (id: string, patch: any) => { const t = demoTasks.find(x => x.id === id); if (t) Object.assign(t, patch); return t },
  tasksToggle: async (id: string) => { const t = demoTasks.find(x => x.id === id); if (t) t.done = !t.done; return t },
  tasksDelete: async (id: string) => { const i = demoTasks.findIndex(x => x.id === id); if (i >= 0) demoTasks.splice(i, 1); return true },

  goalsGet: async (date?: string) => ({ date: date ?? todayStr(), items: demoGoals }),
  goalsAdd: async (date: string, text: string) => { demoGoals.push({ text, done: false }); return { date, items: demoGoals } },
  goalsToggle: async (date: string, index: number) => { demoGoals[index].done = !demoGoals[index].done; return { date, items: demoGoals } },
  goalsRemove: async (date: string, index: number) => { demoGoals.splice(index, 1); return { date, items: demoGoals } },
  goalsSuggest: async () => ['Ship the proposal draft', '30-min walk outside', 'Review open tasks'],

  brainLedger: async () => [
    { ts: Date.now() - 3600_000, verb: 'processed', sentence: "Last night's sleep consolidated 2 logs and wrote the report.", path: 'sleep/2026-11-08.md' },
    { ts: Date.now() - 1800_000, verb: 'discovered', sentence: 'The chat stored 1 item in long-term memory.', path: 'long-term/facts.md' },
    { ts: Date.now() - 600_000, verb: 'needs-you', sentence: 'An evolution left a proposal in the brain policy.', path: 'ops/policy.md' }
  ],
  brainSearch: async (query: string) => {
    const q = String(query)
    const temporal = /o que valia|valia em|valiam|na [eé]poca|as of|no dia|na data/i.test(q)
    const hits = demoMemory.filter(m => m.content.toLowerCase().includes(q.toLowerCase())).map(m => ({ path: m.path, title: m.path, snippet: m.content.slice(0, 120) }))
    if (temporal) return { hits: [], semantic: false, notice: 'No dated fact applied on that date. Undated text does not enter this query.', asOf: '2026-03-31' }
    return { hits, semantic: false, notice: hits.length ? 'Semantic search is idle. These results are text-only.' : 'Semantic search is idle. Nothing matched by text.', asOf: null }
  },
  brainFacts: async () => demoFacts,
  brainFactAccept: async (id: string) => { demoFacts = demoFacts.filter(f => f.id !== id); return 'Fact accepted. The next prompt can use it.' },
  brainFactDiscard: async (id: string) => { demoFacts = demoFacts.filter(f => f.id !== id); return 'Proposta descartada.' },
  brainCapture: async () => 'Sentence saved. It counts immediately.',
  brainCorrect: async () => 'Correction saved. It counts now, and the eval will check it next sleep.',
  brainEval: async () => ({ questions: [{ q: 'Where does durable memory live?', source: 'gap' }], last: { day: todayStr(), hit: 1, total: 1 } }),
  brainBriefing: async () => 'Demo briefing. New facts are waiting for you below.',
  automationPending: async () => [],
  automationApprove: async () => true,
  automationReject: async () => true,
  onCapture: () => () => {},
  brainCards: async () => [{ q: 'Where does durable memory live?', a: 'In long-term/, inside the repo.' }],
  brainGradeCard: async () => ({ due: Date.now() + 86_400_000 }),
  brainPolicy: async () => ({ active: 'No extra instructions yet.', proposals: ['- 2026-11-08: Split person facts into entity pages.'] }),
  brainPolicyApply: async () => 'Active policy updated.',
  brainSkills: async () => ({
    items: demoSkillItems,
    suggestions: [{
      slug: 'research-skill', name: 'Research', description: 'Public research package.', type: 'skill', installs: 120, alreadyHave: false
    }],
    hints: demoSkillHints,
    notes: [{
      path: 'skills/research.md', at: new Date().toISOString(), score: 72, formatScore: 84, substanceScore: 61,
      rationale: 'The structure is clear and the example is still generic.',
      actions: ["Add an example using the user's vocabulary."],
      pillars: [
        { name: 'Scope', score: 80, rationale: 'You can see where the skill starts and ends.' },
        { name: 'Example', score: 58, rationale: "The example does not use the person's vocabulary." }
      ]
    }],
    segments: [{ id: 'KeepMind', count: 4 }, { id: 'SuperagentSkill', count: 1 }, { id: 'camaha', count: 1 }],
    categories: [
      { id: 'cybersec', label: 'Cybersec', count: 1 },
      { id: 'automation', label: 'Automation', count: 2 },
      { id: 'development', label: 'Development', count: 1 },
      { id: 'marketing', label: 'Marketing', count: 1 },
      { id: 'research', label: 'Research', count: 1 },
      { id: 'writing', label: 'Writing', count: 0 },
      { id: 'product', label: 'Product', count: 0 },
      { id: 'sales', label: 'Sales', count: 0 },
      { id: 'operations', label: 'Operations', count: 0 },
      { id: 'other', label: 'Other', count: 0 }
    ],
    threats: []
  }),
  brainSkillThreatScan: async () => ({
    threats: [{
      path: 'skills/research.md', slug: 'research', at: new Date().toISOString(),
      status: 'clean' as const, score: 7.5, findingsCritical: 0, findingsPublic: 0,
      injection: 'Injection guard: clean.',
      summary: 'trust 7.5 · no public robustness findings',
      findings: []
    }],
    hints: []
  }),
  brainSkillKeep: async (path: string) => {
    const kept = demoSkillItems.find(s => s.path === path)
    const archived = demoSkillItems.filter(s => s.title === kept?.title && s.path !== path).map(s => s.path)
    demoSkillItems = demoSkillItems.filter(s => s.path === path || s.title !== kept?.title)
    demoSkillHints = demoSkillHints.filter(h => h.kind !== 'duplicate')
    return { kept: path, archived }
  },
  brainSkillInstall: async (slug: string) => ({
    file: `${slug}.md`, path: `skills/${slug}.md`, group: 'keepmind', segment: 'SuperagentSkill',
    title: slug, ageDays: 0, uses: 0, mentions: 0, kind: 'skill', slug, excerpt: ''
  }),
  brainSkillSearch: async (query: string) => [{
    slug: 'demo', name: query, description: 'Demo result.', type: 'skill', installs: 1, alreadyHave: false
  }],
  brainSkillReview: async (path: string) => ({
    path, at: new Date().toISOString(), score: 70, formatScore: 80, substanceScore: 60,
    rationale: 'The structure is clear and the example is still generic.',
    actions: ["Add an example using the user's vocabulary."],
    pillars: []
  }),
  brainSkillTrust: async (slug: string) => ({ slug, score: 80, summary: 'Demo trust score, 80/100.' }),
  brainSkillEvolve: async () => ({ report: 'Demo evolution.', hints: [] }),
  onJob: () => () => {},
  onBrainStep: () => () => {},

  updaterStatus: async () => ({ version: '0.1.0', packaged: false }),
  updaterCheck: async () => ({ packaged: false }),
  updaterInstall: async () => false,
  onUpdaterEvent: () => () => {},

  // stubs for APIs added after the shim — keep browser preview from crashing
  aiCodexStatus: async () => ({ loggedIn: false }),
  appLaunchAtLogin: async () => false,
  appSetLaunchAtLogin: async () => false,
  automationSetWebhook: async () => false,
  brainActivity: async () => [],
  brainExportConfig: async () => 'demo',
  brainGraph: async () => ({ nodes: [], links: [] }),
  brainHealth: async () => ({ stats: {}, recommendations: [] }),
  brainHealthApply: async () => ({ applied: [] }),
  brainMemoryFile: async () => '',
  connectInfo: async () => ({ mcpScript: '', memoryDir: '', memoryRoot: 'memory/', repoUrl: null, repoOwner: null, repoName: null }),
  layaDownload: async () => false,
  layaStatus: async () => ({ ready: false }),
  layaTest: async () => null,
  modelsDelete: async () => false,
  modelsList: async () => [],
  onActivityPush: () => () => {},
  onLayaProgress: () => () => {},
  securityAiAlerts: async () => [],
  memorySecurityConfigure: async () => ({}),
  memorySecurityStatus: async () => ({ configured: false, unlocked: false, space: 'personal', encryptAll: true }),
  securityConfigure: async (_patch: any) => ({}),
  securityDecryptAll: async () => ({}),
  securityEncryptAll: async () => ({}),
  securityScan: async () => ({ hits: [], pii: [] }),
  securityStatus: async () => ({ enabled: false, folders: [] }),

  openExternal: noopVoid
}

export function installBrowserShim() {
  if (typeof window !== 'undefined' && !(window as any).sb) {
    ;(window as any).sb = demo
    ;(window as any).__KEEPMIND_DEMO__ = true
  }
}
