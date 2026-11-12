const app = document.querySelector('#app')
const state = { me: null, meta: null, section: 'overview', data: null, toast: '', error: '', preview: '' }

const SECTIONS = [
  ['overview', 'Visão', () => true],
  ['policy', 'Política', () => true],
  ['secrets', 'Chaves org', role => role === 'owner' || role === 'admin'],
  ['sync', 'Sync (tokens)', role => role === 'owner' || role === 'admin'],
  ['sso', 'SSO (OIDC)', role => role === 'owner' || role === 'admin'],
  ['teams', 'Times', () => true],
  ['metering', 'Metering', role => role === 'owner' || role === 'admin'],
  ['github', 'GitHub sync', role => role === 'owner' || role === 'admin'],
  ['members', 'Pessoas', role => role === 'owner' || role === 'admin'],
  ['agents', 'Agentes', () => true],
  ['vault', 'Cofre', () => true],
  ['audit', 'Auditoria', role => role === 'owner' || role === 'admin' || role === 'auditor'],
  ['scan', 'Varredura', role => role === 'owner' || role === 'admin' || role === 'auditor']
]

const COPY = {
  bad_login: 'Email ou senha não conferem.',
  rate_limited: 'Muitas tentativas. Espere alguns minutos.',
  forbidden: 'Seu papel não pode fazer isso.',
  shadow_key: 'A chave fica no ambiente da empresa. Chave pessoal não é gravada.',
  above_ceiling: 'A autonomia do time não pode passar do teto da empresa.',
  secret_blocked: 'A nota tem uma credencial e não foi salva.',
  last_owner: 'O último dono continua dono.',
  setup_required: 'Ainda não há dono. Conclua o onboarding na página inicial.',
  bad_user: 'Confira o email, a senha (12 caracteres) e o papel.',
  unauthorized: 'Entre de novo.'
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

async function api(pathname, options = {}) {
  const res = await fetch(pathname, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-keepmind-corp': '1',
      ...(options.headers || {})
    }
  })
  const body = await res.json().catch(() => ({ ok: false, error: 'server_error' }))
  if (res.status === 401 && pathname !== '/api/login') {
    state.me = null
    state.section = 'overview'
    render()
  }
  return { status: res.status, body }
}

function toast(text) {
  state.toast = text
  state.error = ''
}

async function boot() {
  const meta = await api('/api/meta')
  state.meta = meta.body
  const me = await api('/api/session')
  state.me = me.body.user || null
  if (!state.me) {
    window.location.replace('/')
    return
  }
  if (state.me.role !== 'owner' && state.me.role !== 'admin') {
    window.location.replace('/brain/')
    return
  }
  await load()
  render()
}

async function load() {
  if (state.section === 'overview') state.data = (await api('/api/overview')).body
  if (state.section === 'policy') state.data = (await api('/api/policy')).body
  if (state.section === 'secrets') {
    const [org, llm] = await Promise.all([api('/api/org-secrets'), api('/api/llm-secrets')])
    state.data = { ...org.body, llmSecrets: llm.body.secrets || {} }
  }
  if (state.section === 'sync') {
    const [tokens, agents, members] = await Promise.all([
      api('/api/sync-tokens'),
      api('/api/agents'),
      api('/api/members')
    ])
    state.data = { ok: true, tokens: tokens.body.tokens, agents: agents.body.agents, members: members.body.members }
  }
  if (state.section === 'sso') state.data = (await api('/api/oidc-config')).body
  if (state.section === 'teams') state.data = (await api('/api/teams')).body
  if (state.section === 'metering') {
    const [meter, byok] = await Promise.all([api('/api/metering'), api('/api/byok-report?days=30')])
    state.data = { ok: true, ...meter.body, byok: byok.body.report }
  }
  if (state.section === 'github') state.data = (await api('/api/github-sync')).body
  if (state.section === 'members') state.data = (await api('/api/members')).body
  if (state.section === 'agents') {
    const agents = await api('/api/agents')
    state.data = agents.body
  }
  if (state.section === 'vault') state.data = (await api('/api/files')).body
  if (state.section === 'audit') {
    const audit = await api('/api/audit')
    state.data = audit.body
  }
  if (state.section === 'scan') state.data = (await api('/api/scan')).body
}

function render() {
  app.innerHTML = state.me ? shell() : login()
  bind()
}

function login() {
  const sso = state.meta?.oidc ? '<a class="btn ghost" href="/api/oidc/start">Entrar com SSO</a>' : ''
  const setup = state.meta?.setupRequired ? `<p class="err">Ainda não há dono. Abra a <a href="/">página inicial</a> e conclua o onboarding.</p>` : ''
  return `<div class="login"><form class="card" id="login">
    <div class="mark">KeepMind Corp</div>
    <h1>Governança</h1>
    <p class="sub">Política da empresa, pessoas e agentes. O second brain fica em <a href="/brain/">KeepMind</a>.</p>
    ${setup}
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required />
    <label for="password">Senha</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <p class="err" id="login-error">${esc(state.error)}</p>
    <div class="row"><button class="btn" type="submit">Entrar</button>${sso}</div>
  </form></div>`
}

function shell() {
  const nav = SECTIONS.filter(([, , allow]) => allow(state.me.role)).map(([id, label]) =>
    `<button type="button" data-section="${id}" class="${state.section === id ? 'active' : ''}">${label}</button>`
  ).join('')
  return `<div class="shell">
    <nav>
      <div class="mark">KeepMind Corp</div>
      <p class="sub">${esc(state.me.name)} · ${esc(state.me.role)}</p>
      ${nav}
      <button type="button" id="logout">Sair</button>
    </nav>
    <main>
      <div class="top"><h1>${esc(SECTIONS.find(item => item[0] === state.section)?.[1] || '')}</h1><span class="pill">${esc(state.meta?.version || '')}</span></div>
      <p class="toast">${esc(state.toast)}</p>
      <p class="err">${esc(state.error)}</p>
      ${section()}
    </main>
  </div>`
}

function section() {
  const data = state.data || {}
  if (!data.ok && data.error) return `<p>${esc(COPY[data.error] || 'Sem acesso a esta área.')}</p>`
  if (state.section === 'overview') return overview(data)
  if (state.section === 'policy') return policy(data.policy)
  if (state.section === 'secrets') return orgSecrets(data)
  if (state.section === 'sync') return syncTokens(data)
  if (state.section === 'sso') return ssoConfig(data)
  if (state.section === 'teams') return teams(data)
  if (state.section === 'metering') return metering(data)
  if (state.section === 'github') return githubSync(data)
  if (state.section === 'members') return members(data)
  if (state.section === 'agents') return agents(data)
  if (state.section === 'vault') return vault(data)
  if (state.section === 'audit') return audit(data)
  if (state.section === 'scan') return scan(data)
  return ''
}

function overview(data) {
  const scan = data.scan || {}
  const enabled = (data.agents || []).filter(agent => agent.enabled).length
  return `<p class="sub">Cada pessoa escreve em people/${esc(state.me.id)}/. O que é da empresa fica em shared/.</p>
    <div class="grid">
      <div class="panel"><div class="k">Provedores</div><div class="v">${esc((data.policy?.providers || []).join(', ') || 'nenhum')}</div></div>
      <div class="panel"><div class="k">Teto de autonomia</div><div class="v">${esc(data.policy?.autonomyCeiling || '')}</div></div>
      <div class="panel"><div class="k">Agentes ligados</div><div class="v">${enabled}</div></div>
      <div class="panel"><div class="k">Segredos / PII</div><div class="v">${scan.secretTotal ?? '—'} / ${scan.piiTotal ?? '—'}</div></div>
    </div>
    <div class="panel"><div class="k">BYOK da empresa</div><p>Chaves pessoais não entram. A política exige a chave da organização, no ambiente do servidor.</p></div>
    ${state.me.role === 'owner' ? '<p class="row"><a class="btn ghost" href="/api/backup" download>Baixar backup do cofre (.tgz)</a></p>' : ''}`
}

function ssoConfig(data) {
  return `<p class="sub">SSO via OpenID Connect. Depois de salvar, o login mostra <strong>Entrar com SSO</strong>. O client secret fica no cofre (como BYOK).</p>
    <form id="sso" class="panel">
      <label>Issuer (URL)<input name="issuer" value="${esc(data.issuer || '')}" placeholder="https://idp.suaempresa.com" /></label>
      <label>Client ID<input name="clientId" value="${esc(data.clientId || '')}" /></label>
      <label>Redirect URI<input name="redirectUri" value="${esc(data.redirectUri || '')}" placeholder="https://corp.exemplo.com/api/oidc/callback" /></label>
      <label>Grupo admin (claim)<input name="adminGroup" value="${esc(data.adminGroup || 'keepmind-admins')}" /></label>
      <label>Client secret<input name="clientSecret" type="password" autocomplete="new-password" placeholder="${data.secretSet ? 'Substituir…' : 'Obrigatório na 1ª vez'}" /></label>
      <p class="sub">Status: ${data.active ? 'SSO ativo' : 'SSO inativo'} · secret ${data.secretSet ? 'ok' : 'faltando'}</p>
      <div class="row"><button class="btn" type="submit">Salvar SSO</button>
      <button type="button" class="btn ghost" id="clear-sso">Remover</button></div>
    </form>`
}

function syncTokens(data) {
  const syncOn = (data.agents || []).some((a) => a.id === 'sync' && a.enabled)
  const rows = (data.tokens || []).map((row) => `<tr>
    <td>${esc(row.label)}<div class="sub">${esc(row.id)}</div></td>
    <td>${esc(row.userEmail || row.userId)}</td>
    <td>${row.revokedAt ? 'revogado' : 'ativo'}</td>
    <td><button type="button" class="btn ghost" data-revoke-token="${esc(row.id)}" ${row.revokedAt ? 'disabled' : ''}>Revogar</button></td>
  </tr>`).join('') || '<tr><td colspan="4">Nenhum token ainda.</td></tr>'
  const members = (data.members || []).map((m) => `<option value="${esc(m.id)}">${esc(m.email)}</option>`).join('')
  return `<p class="sub">Tokens <code>Bearer</code> para <code>tools/corp-push.mjs</code> e automação desktop → Corp. Requer agente <strong>Sync</strong> ligado. O segredo aparece só na criação.</p>
    ${syncOn ? '' : '<p class="err">Ative o agente <strong>Sync</strong> em Agentes antes de usar tokens.</p>'}
  <form id="sync-token" class="panel">
    <label>Rótulo<input name="label" value="desktop-sync" /></label>
    <label>Pessoa (partição de memória)<select name="userId">${members}</select></label>
    <fieldset class="panel" style="border:0;padding:0;margin:0"><legend class="sub">Escopos</legend>
      ${['memory:import','memory:export','mcp:invoke','mcp:read','llm:read'].map(sc =>
        `<label style="display:inline-block;margin-right:12px"><input type="checkbox" name="scope" value="${sc}" checked /> ${sc}</label>`).join('')}
    </fieldset>
    <button class="btn" type="submit">Gerar token</button>
  </form>
  <div id="sync-secret" class="panel" hidden></div>
  <table><thead><tr><th>Token</th><th>Usuário</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
}

function orgSecrets(data) {
  const providers = data.providers || {}
  const rows = ['openai', 'anthropic', 'gemini', 'grok', 'github'].map(id => {
    const set = providers[id]
    return `<tr>
      <td>${esc(id)}</td>
      <td>${set ? 'configurada' : 'vazia'}</td>
      <td><input name="${esc(id)}" type="password" autocomplete="new-password" placeholder="${set ? 'Substituir…' : 'Colar chave…'}" /></td>
    </tr>`
  }).join('')
  const llmRows = Object.entries(data.llmSecrets || {}).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${v.set ? `configurada ${esc(v.hint || '')}` : 'vazia'}</td><td></td></tr>`).join('')
  const writer = state.me.role === 'owner' || state.me.role === 'admin'
  return `<p class="sub">Chaves da organização (BYOK). Nunca são exibidas de volta — só o status. Membros não podem cadastrar chave pessoal no Brain.</p>
    <form id="secrets" class="panel"><table><thead><tr><th>Provedor</th><th>Status</th><th>Nova chave</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="row"><button class="btn" type="submit">Salvar chaves</button>
    <button type="button" class="btn ghost" id="clear-secrets">Limpar todas</button></p></form>
  <h3>Chaves de LLM por escopo</h3>
  <p class="sub">Resolvidas por pessoa: <code>user:</code> &gt; <code>team:</code> &gt; <code>role:</code> &gt; padrão da org. O app do funcionário busca a dele via token de sync com escopo <code>llm:read</code>.</p>
  <table><thead><tr><th>Escopo</th><th>Status</th></tr></thead><tbody>${llmRows || '<tr><td colspan="2">Nenhuma chave por escopo.</td></tr>'}</tbody></table>
  ${writer ? `<form id="llm-secret" class="panel">
    <label>Provedor<select name="provider">${['openai','anthropic','gemini','grok'].map(p => `<option>${p}</option>`).join('')}</select></label>
    <label>Escopo<select name="scope"><option value="">Organização (padrão)</option><option value="role:member">Cargo: member</option><option value="role:admin">Cargo: admin</option><option value="role:owner">Cargo: owner</option><option value="role:auditor">Cargo: auditor</option><option value="__team__">Time (informar ID)</option><option value="__user__">Usuário (informar ID)</option></select></label>
    <label>Escopo ID (só Time/Usuário)<input name="scopeId" placeholder="team-id ou user-id" /></label>
    <label>Chave<input name="value" type="password" autocomplete="new-password" placeholder="sk-…" /></label>
    <button class="btn" type="submit">Salvar chave</button>
  </form>` : ''}`
}

function policy(policy) {
  if (!policy) return ''
  const checks = (state.meta?.providers || []).map(name =>
    `<label><input type="checkbox" name="provider" value="${esc(name)}" ${policy.providers.includes(name) ? 'checked' : ''} ${writer ? '' : 'disabled'}/> ${esc(name)}</label>`
  ).join('')
  const options = (state.meta?.autonomy || []).map(mode =>
    `<option ${policy.autonomyCeiling === mode ? 'selected' : ''}>${esc(mode)}</option>`
  ).join('')
  const writer = state.me.role === 'owner' || state.me.role === 'admin'
  return `<form id="policy" class="panel">
    <p>A retenção fica registrada. Esta versão ainda não apaga o cofre sozinha.</p>
    <div class="checks">${checks}</div>
    <label>Teto de autonomia<select name="autonomyCeiling" ${writer ? '' : 'disabled'}>${options}</select></label>
    <label>Retenção em dias<input name="retentionDays" type="number" min="7" max="3650" value="${esc(policy.retentionDays)}" ${writer ? '' : 'disabled'}/></label>
    <label>Residência<input name="residency" value="${esc(policy.residency)}" ${writer ? '' : 'disabled'}/></label>
    <label>ABAC — pastas <code>shared/</code> (JSON)
      <textarea name="sharedAccess" rows="6" ${writer ? '' : 'disabled'} placeholder='[{"prefix":"shared/finance","roles":["owner","admin"],"titles":["CFO"]}]'>${esc(JSON.stringify(policy.sharedAccess || [], null, 2))}</textarea>
    </label>
    <label>ABAC — pastas <code>people/</code> por cargo/time (JSON)
      <textarea name="peopleAccess" rows="5" ${writer ? '' : 'disabled'} placeholder='[{"prefix":"people/lead/memory/inbox","roles":[],"titles":["diretor"],"teams":["leadership"]}]'>${esc(JSON.stringify(policy.peopleAccess || [], null, 2))}</textarea>
    </label>
    ${writer ? '<button class="btn" type="submit">Salvar política</button>' : ''}
  </form>`
}

function teams(data) {
  const writer = state.me.role === 'owner' || state.me.role === 'admin'
  const lock = writer ? '' : 'disabled'
  const rows = (data.teams || []).map(team => `<tr>
    <td><input data-team="${esc(team.id)}" data-field="name" value="${esc(team.name)}" ${lock}/></td>
    <td>${esc(team.id)}</td>
    <td><select data-team="${esc(team.id)}" data-field="autonomy" ${lock}>${(state.meta?.autonomy || []).map(mode => `<option ${team.autonomy === mode ? 'selected' : ''}>${esc(mode)}</option>`).join('')}</select></td>
    <td><input type="number" min="0" placeholder="∞" data-team="${esc(team.id)}" data-field="budget" value="${team.budgetDaily ?? ''}" ${lock} style="width:6rem"/></td>
    <td class="sub">${esc(team.usageToday ?? 0)}</td>
  </tr>`).join('')
  return `<p class="sub">Teto atual: ${esc(data.ceiling || '')}. <strong>Orçamento/dia</strong> = unidades abstratas (MCP=1, chat nuvem=10).</p>
    <form id="teams"><table><thead><tr><th>Nome</th><th>Id</th><th>Autonomia</th><th>Budget/dia</th><th>Uso hoje</th></tr></thead><tbody>${rows}</tbody></table>
    ${writer ? '<p class="row"><button class="btn" type="submit">Salvar times</button></p>' : ''}</form>`
}

function metering(data) {
  const teams = (data.teams || []).map((t) => `<tr>
    <td>${esc(t.name)} <span class="sub">${esc(t.id)}</span></td>
    <td>${t.budgetDaily ?? '—'}</td>
    <td>${esc(t.usageToday ?? 0)}</td>
    <td>${t.remaining ?? '—'}</td>
  </tr>`).join('')
  const agents = (data.agents || []).map((a) => `<tr>
    <td>${esc(a.name)}</td>
    <td>${a.quotaDaily ?? '—'}</td>
    <td>${esc(a.usageToday ?? 0)}</td>
  </tr>`).join('')
  const costs = data.unitCosts || {}
  return `<p class="sub">Paperclip-light: cotas por agente + orçamento por time (unidades, não USD).</p>
    <h3>Times</h3><table><thead><tr><th>Time</th><th>Budget/dia</th><th>Uso</th><th>Restante</th></tr></thead><tbody>${teams}</tbody></table>
    <h3>Agentes</h3><table><thead><tr><th>Agente</th><th>Cota/dia</th><th>Uso</th></tr></thead><tbody>${agents}</tbody></table>
    <p class="sub">Custos: MCP=${costs.mcp ?? 1} · chat nuvem=${costs.chatCloud ?? 10}</p>
    <h3>BYOK (estimativa 30d)</h3>
    <p class="sub">${esc(data.byok?.disclaimer || '')}</p>
    <p><strong>Total ~$${esc(data.byok?.totalEstUsd ?? 0)}</strong> · ${esc(data.byok?.rows ?? 0)} chamadas</p>
    <pre class="panel">${esc(JSON.stringify(data.byok?.providers || {}, null, 2))}</pre>`
}

function githubSync(data) {
  const cfg = data.config || {}
  return `<p class="sub">Espelha <code>shared/</code> + snapshot de política no GitHub corporativo. Token PAT em <strong>Chaves org → github</strong>. Não sincroniza <code>people/</code>.</p>
    <form id="github-sync" class="panel">
      <label><input type="checkbox" name="enabled" ${cfg.enabled ? 'checked' : ''}/> Ativo</label>
      <label>Owner<input name="owner" value="${esc(cfg.owner || '')}" placeholder="org-name"/></label>
      <label>Repo<input name="repo" value="${esc(cfg.repo || '')}" placeholder="corp-memory"/></label>
      <label>Branch<input name="branch" value="${esc(cfg.branch || 'main')}"/></label>
      <label>Prefixo no repo<input name="repoPrefix" value="${esc(cfg.repoPrefix || 'corp-vault')}"/></label>
      <label><input type="checkbox" name="scheduleEnabled" ${cfg.scheduleEnabled ? 'checked' : ''}/> Agendamento (verifica a cada 5 min)</label>
      <label>Intervalo alvo (min)<input type="number" name="intervalMinutes" min="15" max="1440" value="${esc(cfg.intervalMinutes || 60)}"/></label>
      <label>Secret CI (header X-KeepMind-Hook)<input type="password" name="hookSecret" placeholder="${cfg.hookSecretSet ? 'Substituir…' : 'opcional'}" autocomplete="new-password"/></label>
      <p class="sub">Token: ${data.hasToken ? 'ok' : 'faltando'} · Último: ${esc(cfg.lastMessage || '—')} · POST /api/hooks/github-sync</p>
      <div class="row">
        <button class="btn" type="submit">Salvar</button>
        <button type="button" class="btn ghost" id="github-run">Sync agora</button>
      </div>
    </form>`
}

function members(data) {
  if (!data.members) return '<p>A lista de pessoas fica com dono e admin.</p>'
  const rows = data.members.map(member => `<tr>
    <td>${esc(member.name)}<div class="sub">${esc(member.email)}${member.title ? ` · ${esc(member.title)}` : ''}</div></td>
    <td><span class="pill">${esc(member.role)}</span></td>
    <td>${esc(member.teamId)}</td>
    <td>${member.disabled ? 'inativa' : 'ativa'}</td>
  </tr>`).join('')
  return `<form id="member" class="panel">
      <div class="row">
        <input name="name" placeholder="Nome" autocomplete="name" required />
        <input name="title" placeholder="Cargo (opcional)" autocomplete="off" />
        <input name="email" type="email" placeholder="Email" autocomplete="off" required />
        <input name="password" type="password" placeholder="Senha (12+)" autocomplete="new-password" required />
        <select name="role"><option>member</option><option>auditor</option><option>admin</option>${state.me.role === 'owner' ? '<option>owner</option>' : ''}</select>
        <button class="btn" type="submit">Adicionar</button>
      </div>
    </form>
    <table><thead><tr><th>Pessoa</th><th>Papel</th><th>Time</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
}

function agents(data) {
  const modes = state.meta?.autonomy || []
  const rows = (data.agents || []).map(agent => `<tr>
    <td>${esc(agent.name)}<div class="sub">${esc(agent.id)}${agent.kind === 'app' ? ' · app' : ''}${agent.description ? ` — ${esc(agent.description)}` : ''}</div></td>
    <td>${esc(agent.teamId)}</td>
    <td><select data-agent-autonomy="${esc(agent.id)}" ${state.me.role === 'member' || state.me.role === 'auditor' ? 'disabled' : ''}>${modes.map(m => `<option ${(agent.autonomyMax || 'supervised') === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></td>
    <td><input type="number" min="0" placeholder="∞" data-agent-quota="${esc(agent.id)}" value="${agent.quotaDaily ?? ''}" ${state.me.role === 'member' || state.me.role === 'auditor' ? 'disabled' : ''} style="width:5rem"/></td>
    <td class="sub">${esc(agent.usageToday ?? 0)}${agent.usageDay ? ` · ${esc(agent.usageDay)}` : ''}</td>
    <td><input type="checkbox" data-agent="${esc(agent.id)}" ${agent.enabled ? 'checked' : ''} ${state.me.role === 'member' || state.me.role === 'auditor' ? 'disabled' : ''}/></td>
  </tr>`).join('')
  const writer = state.me.role === 'owner' || state.me.role === 'admin'
  return `<p class="sub">Autorize agentes do tenant (brain, ingest, sync, <strong>Cursor Composer</strong> como conector de app). Runtime MCP completo vem no roadmap v0.4.</p>
    <form id="agents"><table><thead><tr><th>Agente</th><th>Time</th><th>Autonomia máx.</th><th>Cota/dia</th><th>Uso hoje</th><th>Ligado</th></tr></thead><tbody>${rows}</tbody></table>
    ${writer ? '<p><button class="btn" type="submit">Salvar agentes</button></p>' : ''}</form>`
}

function vault(data) {
  const files = data.files || []
  const list = files.map(file => `<button type="button" class="filebtn ${state.previewPath === file.path ? 'active' : ''}" data-file="${esc(file.path)}">${esc(file.path)}${file.encrypted ? ' · cifrado' : ''}</button>`).join('') || '<p>Nenhum arquivo visível.</p>'
  const own = `people/${state.me.id}/nota.md`
  const writer = state.me.role !== 'auditor'
  return `<div class="split">
    <div class="panel">${list}</div>
    <div>
      <pre class="panel" id="preview">${esc(state.preview || 'Escolha um arquivo.')}</pre>
      ${writer ? `<form id="note" class="panel">
        <label>Caminho<input name="path" value="${esc(state.draftPath || own)}"/></label>
        <label>Nota<textarea name="text" placeholder="Markdown"></textarea></label>
        <button class="btn" type="submit">Salvar no cofre</button>
      </form>` : ''}
    </div>
  </div>`
}

function audit(data) {
  if (!data.entries) return '<p>A auditoria fica com dono, admin e auditor.</p>'
  const rows = data.entries.map(entry => `<tr><td>${esc(entry.ts)}</td><td>${esc(entry.actor)}</td><td>${esc(entry.op)}</td><td>${esc(entry.path || entry.email || '')}</td></tr>`).join('')
  return `<p class="row"><a class="btn ghost" href="/api/audit/export?format=ndjson" download>Export NDJSON (SIEM)</a>
    <a class="btn ghost" href="/api/audit/export?format=csv" download>Export CSV</a></p>
    <table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Onde</th></tr></thead><tbody>${rows}</tbody></table>`
}

function scan(data) {
  const scan = data.scan
  if (!scan) return '<p>A varredura fica com dono, admin e auditor.</p>'
  const secrets = (scan.secrets || []).map(hit => `<tr><td>${esc(hit.path)}</td><td>${esc(hit.line)}</td><td>${esc(hit.label)}</td></tr>`).join('')
  const paths = scan.secrets ? `<table><thead><tr><th>Arquivo</th><th>Linha</th><th>Tipo</th></tr></thead><tbody>${secrets || '<tr><td colspan="3">Nenhum segredo.</td></tr>'}</tbody></table>` : '<p>O auditor vê os totais. O caminho de cada achado fica com dono e admin.</p>'
  return `<div class="grid">
      <div class="panel"><div class="k">Segredos</div><div class="v">${esc(scan.secretTotal)}</div></div>
      <div class="panel"><div class="k">PII</div><div class="v">${esc(scan.piiTotal)}</div></div>
      <div class="panel"><div class="k">Arquivos cifrados</div><div class="v">${esc(scan.encryptedFiles)}</div></div>
    </div>${paths}`
}

function bind() {
  document.querySelector('#login')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) })
    if (!res.body.ok) {
      state.error = COPY[res.body.error] || 'Não foi possível entrar.'
      render()
      return
    }
    window.location.replace('/brain/')
  })
  document.querySelectorAll('[data-section]').forEach(button => {
    button.addEventListener('click', async () => {
      state.section = button.dataset.section
      state.toast = ''
      state.error = ''
      state.preview = ''
      await load()
      render()
    })
  })
  document.querySelector('#logout')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST', body: '{}' })
    state.me = null
    state.section = 'overview'
    render()
  })
  document.querySelector('#sso')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/oidc-config', {
      method: 'PUT',
      body: JSON.stringify({
        issuer: form.get('issuer'),
        clientId: form.get('clientId'),
        redirectUri: form.get('redirectUri'),
        adminGroup: form.get('adminGroup'),
        clientSecret: form.get('clientSecret')
      })
    })
    state.toast = res.body.ok ? 'SSO salvo.' : (res.body.message || COPY[res.body.error] || 'Não salvou.')
    if (res.body.ok) state.data = res.body
    render()
  })
  document.querySelector('#clear-sso')?.addEventListener('click', async () => {
    const res = await api('/api/oidc-config', { method: 'DELETE' })
    state.toast = res.body.ok ? 'SSO removido.' : 'Não removeu.'
    if (res.body.ok) state.data = res.body
    render()
  })
  document.querySelector('#secrets')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const providers = {}
    for (const id of ['openai', 'anthropic', 'gemini', 'grok', 'github']) {
      const v = String(form.get(id) || '').trim()
      if (v) providers[id] = v
    }
    const res = await api('/api/org-secrets', { method: 'PUT', body: JSON.stringify({ providers }) })
    state.toast = res.body.ok ? 'Chaves salvas.' : (COPY[res.body.error] || 'Não salvou.')
    if (res.body.ok) state.data = res.body
    render()
  })
  document.querySelector('#llm-secret')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    let scope = String(form.get('scope') || '')
    const scopeId = String(form.get('scopeId') || '').trim()
    if (scope === '__team__') scope = scopeId ? `team:${scopeId}` : ''
    else if (scope === '__user__') scope = scopeId ? `user:${scopeId}` : ''
    else if (scope.startsWith('__')) scope = ''
    const res = await api('/api/llm-secrets', {
      method: 'PUT',
      body: JSON.stringify({ entries: [{ provider: form.get('provider'), scope, value: form.get('value') }] })
    })
    state.toast = res.body.ok ? 'Chave de LLM salva.' : (COPY[res.body.error] || 'Não salvou.')
    if (res.body.ok) { state.data = { ...state.data, llmSecrets: res.body.secrets }; await load(); }
    render()
  })
  document.querySelector('#clear-secrets')?.addEventListener('click', async () => {
    const res = await api('/api/org-secrets', {
      method: 'PUT',
      body: JSON.stringify({ providers: { openai: '', anthropic: '', gemini: '', grok: '' } })
    })
    state.toast = res.body.ok ? 'Chaves removidas.' : 'Não limpou.'
    if (res.body.ok) state.data = res.body
    render()
  })
  document.querySelector('#github-sync')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/github-sync', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: !!form.get('enabled'),
        owner: form.get('owner'),
        repo: form.get('repo'),
        branch: form.get('branch'),
        repoPrefix: form.get('repoPrefix'),
        scheduleEnabled: !!form.get('scheduleEnabled'),
        intervalMinutes: Number(form.get('intervalMinutes')) || 60,
        hookSecret: form.get('hookSecret')
      })
    })
    state.toast = res.body.ok ? 'GitHub sync salvo.' : (res.body.message || 'Não salvou.')
    if (res.body.ok) await load()
    render()
  })
  document.querySelector('#github-run')?.addEventListener('click', async () => {
    const res = await api('/api/github-sync/run', { method: 'POST', body: JSON.stringify({ direction: 'both' }) })
    state.toast = res.body.ok ? res.body.message : (res.body.message || 'Falhou.')
    if (res.body.ok) await load()
    render()
  })
  document.querySelector('#sync-token')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/sync-tokens', {
      method: 'POST',
      body: JSON.stringify({
        label: form.get('label'),
        userId: form.get('userId'),
        scopes: [...(event.target?.querySelectorAll('input[name="scope"]:checked') || [])].map(i => i.value)
      })
    })
    if (res.body.ok && res.body.token?.secret) {
      const box = document.querySelector('#sync-secret')
      if (box) {
        box.hidden = false
        box.innerHTML = `<p class="sub"><strong>Copie agora</strong> — não mostramos de novo:</p>
          <pre>${esc(res.body.token.secret)}</pre>
          <p class="sub">Use: <code>KEEPMIND_CORP_TOKEN=… node tools/corp-push.mjs --url … --dir ./memory</code></p>`
      }
      toast('Token criado.')
      await load()
      render()
      return
    }
    state.toast = res.body.message || COPY[res.body.error] || 'Não criou token.'
    render()
  })
  document.querySelectorAll('[data-revoke-token]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.revokeToken
      const res = await api(`/api/sync-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
      state.toast = res.body.ok ? 'Token revogado.' : (COPY[res.body.error] || 'Não revogou.')
      if (res.body.ok) await load()
      render()
    })
  })
  document.querySelector('#policy')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/policy', {
      method: 'PUT',
      body: JSON.stringify({
        providers: form.getAll('provider'),
        autonomyCeiling: form.get('autonomyCeiling'),
        retentionDays: Number(form.get('retentionDays')),
        residency: form.get('residency'),
        sharedAccess: (() => {
          try {
            const raw = String(form.get('sharedAccess') || '[]')
            const parsed = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })(),
        peopleAccess: (() => {
          try {
            const raw = String(form.get('peopleAccess') || '[]')
            const parsed = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })()
      })
    })
    state.toast = res.body.ok ? 'Política salva.' : (COPY[res.body.error] || 'Não salvou.')
    if (res.body.ok) state.data = { ok: true, policy: res.body.policy }
    render()
  })
  document.querySelector('#teams')?.addEventListener('submit', async event => {
    event.preventDefault()
    const teams = (state.data.teams || []).map(team => {
      const bRaw = document.querySelector(`[data-team="${CSS.escape(team.id)}"][data-field="budget"]`)?.value
      const budgetDaily = bRaw === '' || bRaw == null ? null : Number(bRaw)
      return {
        id: team.id,
        name: document.querySelector(`[data-team="${CSS.escape(team.id)}"][data-field="name"]`)?.value || team.name,
        autonomy: document.querySelector(`[data-team="${CSS.escape(team.id)}"][data-field="autonomy"]`)?.value || team.autonomy,
        budgetDaily: Number.isFinite(budgetDaily) ? budgetDaily : null
      }
    })
    const res = await api('/api/teams', { method: 'PUT', body: JSON.stringify({ teams }) })
    state.error = res.body.ok ? '' : (COPY[res.body.error] || res.body.message || 'Não salvou.')
    state.toast = res.body.ok ? 'Times salvos.' : ''
    if (res.body.ok) state.data = res.body
    render()
  })
  document.querySelector('#member')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/members', {
      method: 'POST',
      body: JSON.stringify({
        name: form.get('name'),
        title: form.get('title'),
        email: form.get('email'),
        password: form.get('password'),
        role: form.get('role')
      })
    })
    state.error = res.body.ok ? '' : (COPY[res.body.error] || res.body.message || 'Não adicionou.')
    state.toast = res.body.ok ? 'Pessoa adicionada.' : ''
    if (res.body.ok) await load()
    render()
  })
  document.querySelector('#agents')?.addEventListener('submit', async event => {
    event.preventDefault()
    const agents = (state.data.agents || []).map(agent => {
      const qRaw = document.querySelector(`[data-agent-quota="${CSS.escape(agent.id)}"]`)?.value
      const quotaDaily = qRaw === '' || qRaw == null ? null : Number(qRaw)
      return {
        ...agent,
        enabled: !!document.querySelector(`[data-agent="${CSS.escape(agent.id)}"]`)?.checked,
        autonomyMax: document.querySelector(`[data-agent-autonomy="${CSS.escape(agent.id)}"]`)?.value || agent.autonomyMax,
        quotaDaily: Number.isFinite(quotaDaily) ? quotaDaily : null
      }
    })
    const res = await api('/api/agents', { method: 'PUT', body: JSON.stringify({ agents }) })
    state.toast = res.body.ok ? 'Agentes salvos.' : (COPY[res.body.error] || 'Não salvou.')
    if (res.body.ok) state.data = res.body
    render()
  })
  document.querySelectorAll('[data-file]').forEach(button => {
    button.addEventListener('click', async () => {
      const res = await api(`/api/files/preview?path=${encodeURIComponent(button.dataset.file)}`)
      state.previewPath = button.dataset.file
      state.preview = res.body.encrypted ? 'Arquivo cifrado em repouso (KMS1). O texto não é aberto aqui.' : (res.body.text || '')
      render()
    })
  })
  document.querySelector('#note')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    state.draftPath = String(form.get('path') || '')
    const res = await api('/api/files', { method: 'POST', body: JSON.stringify({ path: form.get('path'), text: form.get('text') }) })
    state.error = res.body.ok ? '' : (COPY[res.body.error] || res.body.message || 'Não salvou.')
    state.toast = res.body.ok ? 'Nota salva.' : ''
    if (res.body.ok) await load()
    render()
  })
}

void boot()
