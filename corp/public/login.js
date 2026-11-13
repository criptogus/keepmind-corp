const roleLabel = role => ({ member: 'membro', admin: 'administrador', auditor: 'auditor' }[role] || role)
const app = document.querySelector('#app')

const COPY = {
  bad_login: 'Email ou senha não conferem.',
  rate_limited: 'Muitas tentativas. Espere alguns minutos.',
  weak_password: 'Use uma senha com pelo menos 12 caracteres.',
  mismatch: 'As senhas não conferem.',
  bad_email: 'Email inválido.',
  setup_done: 'O dono já foi criado — use o login.'
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

async function api(pathname, options = {}) {
  try {
  const res = await fetch(pathname, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-keepmind-corp': '1', ...(options.headers || {}) }
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
  } catch { return { status: 0, body: { ok: false, message: 'Sem conexão com o servidor. Tente novamente.' } } }
}

let wizardStep = 0
let wizardMeta = null
let wizardForm = {
  setupToken: '',
  orgName: '',
  name: '',
  email: '',
  password: '',
  confirm: ''
}

async function boot() {
  const token = new URLSearchParams(location.hash.slice(1)).get('invite')
  if (token) { history.replaceState(null, '', '/'); return showInvitation(token) }
  const session = await api('/api/session')
  if (session.body?.user) {
    window.location.replace('/brain/')
    return
  }
  const meta = await api('/api/meta')
  wizardMeta = meta.body
  if (meta.body?.setupRequired) renderWizard('')
  else renderLogin(meta.body, '')
}

function stepDots(n, total = 4) {
  let html = '<div class="ob-steps">'
  for (let i = 0; i < total; i++) html += `<span class="${i <= n ? 'on' : ''}"></span>`
  return html + '</div>'
}

function renderWizard(error) {
  const sso = wizardMeta?.oidc ? '<p class="sub">Sua empresa pode usar <a href="/api/oidc/start">SSO</a> depois da conta de dono existir.</p>' : ''
  let inner = ''
  if (wizardStep === 0) {
    inner = `${stepDots(0)}
    <h1>Crie o workspace da sua empresa</h1>
    <p class="sub">Um lugar para a equipe recuperar conhecimento, conferir fontes e trabalhar com as regras da empresa.</p>
    <div class="ob-illus">
      <strong>Você ganha</strong>
      <ul>
        <li><strong>Conhecimento com contexto</strong> — encontre o que sua equipe precisa para continuar.</li>
        <li><strong>Controle da empresa</strong> — administradores gerenciam pessoas, IA e auditoria.</li>
        <li><strong>Privacidade</strong> — memórias pessoais e conteúdo compartilhado têm permissões próprias.</li>
      </ul>
    </div>
    ${wizardMeta?.serverMode ? `<label for="setupToken">Chave de instalação</label><input id="setupToken" type="password" autocomplete="off" value="${esc(wizardForm.setupToken)}" required aria-describedby="setup-help" /><p class="sub" id="setup-help">Peça esta chave ao responsável pelo servidor. Ela protege a criação do primeiro administrador.</p>` : ''}<div class="ob-actions"><button type="button" class="btn" id="next">Começar configuração</button></div>`
  } else if (wizardStep === 1) {
    inner = `${stepDots(1)}
    <h1>Sua empresa no Corp</h1>
    <p class="sub">Nome que aparece para todo mundo na barra superior e nos relatórios.</p>
    <label for="orgName">Nome da organização</label>
    <input id="orgName" name="orgName" value="${esc(wizardForm.orgName)}" placeholder="Ex.: Acme Brasil" required />
    <div class="ob-actions">
      <button type="button" class="btn ghost" id="back">Voltar</button>
      <button type="button" class="btn" id="next">Continuar</button>
    </div>`
  } else if (wizardStep === 2) {
    inner = `${stepDots(2)}
    <h1>Administrador principal</h1>
    <p class="sub">Você será responsável pelo workspace: poderá convidar colegas e definir as regras da empresa.</p>
    <label for="name">Seu nome</label>
    <input id="name" name="name" value="${esc(wizardForm.name)}" autocomplete="name" required />
    <label for="email">Email de trabalho</label>
    <input id="email" name="email" type="email" value="${esc(wizardForm.email)}" autocomplete="username" required />
    <div class="ob-actions">
      <button type="button" class="btn ghost" id="back">Voltar</button>
      <button type="button" class="btn" id="next">Continuar</button>
    </div>`
  } else {
    inner = `${stepDots(3)}
    <h1>Proteja a conta</h1>
    <p class="sub">Mínimo de 12 caracteres. Guarde em um gerenciador de senhas.</p>
    <label for="password">Senha</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required />
    <label for="confirm">Confirmar senha</label>
    <input id="confirm" name="confirm" type="password" autocomplete="new-password" required />

    <div class="ob-actions">
      <button type="button" class="btn ghost" id="back">Voltar</button>
      <button type="button" class="btn" id="finish">Criar organização e entrar</button>
    </div>
    ${sso}`
  }

  app.innerHTML = `<div class="ob-wrap"><form class="card ob-card" id="wizard">
    <div class="mark">KeepMind Corp</div>
    <p class="err" role="alert" tabindex="-1" id="form-error">${esc(error)}</p>
    ${inner}
  </form></div>`

  document.querySelector('#wizard')?.addEventListener('submit', e => { e.preventDefault(); document.querySelector('#next, #finish')?.click() })
  if (error) document.querySelector('#form-error').focus(); else { const heading = document.querySelector('h1'); heading.tabIndex = -1; heading.focus() }
  document.querySelector('#back')?.addEventListener('click', () => {
    syncWizardFields()
    wizardStep = Math.max(0, wizardStep - 1)
    renderWizard('')
  })
  document.querySelector('#next')?.addEventListener('click', () => {
    syncWizardFields()
    if (wizardStep === 0 && wizardMeta?.serverMode && !wizardForm.setupToken.trim()) return renderWizard('Informe a chave de instalação fornecida pelo responsável pelo servidor.')
    if (wizardStep === 1 && !wizardForm.orgName.trim()) {
      renderWizard('Informe o nome da organização.')
      return
    }
    if (wizardStep === 2) {
      if (!wizardForm.name.trim()) return renderWizard('Informe seu nome.')
      if (!wizardForm.email.includes('@')) return renderWizard('Email inválido.')
    }
    wizardStep = Math.min(3, wizardStep + 1)
    renderWizard('')
  })
  document.querySelector('#finish')?.addEventListener('click', async () => {
    syncWizardFields()
    const finish = document.querySelector('#finish'); finish.disabled = true; finish.textContent = 'Criando workspace…'
    const res = await api('/api/setup', {
      method: 'POST',
      body: JSON.stringify(wizardForm)
    })
    if (!res.body.ok) {
      const msg = res.body.message || COPY[res.body.error] || 'Não foi possível concluir o setup.'
      if (res.body.error === 'setup_token') wizardStep = 0
      if (res.body.error === 'bad_email') wizardStep = 2
      if (res.body.error === 'bad_org') wizardStep = 1
      renderWizard(msg)
      return
    }
    window.location.replace('/brain/')
  })
}

function syncWizardFields() {
  const setup = document.querySelector('#setupToken'); if (setup) wizardForm.setupToken = setup.value
  const org = document.querySelector('#orgName')
  const name = document.querySelector('#name')
  const email = document.querySelector('#email')
  const password = document.querySelector('#password')
  const confirm = document.querySelector('#confirm')
  if (org) wizardForm.orgName = org.value
  if (name) wizardForm.name = name.value
  if (email) wizardForm.email = email.value
  if (password) wizardForm.password = password.value
  if (confirm) wizardForm.confirm = confirm.value
}

function renderLogin(meta, error) {
  const sso = meta?.oidc ? '<a class="btn ghost" href="/api/oidc/start">Entrar com SSO</a>' : ''
  app.innerHTML = `<div class="login"><form class="card" id="login">
    <div class="mark">KeepMind Corp</div>
    <h1>Entrar em ${esc(meta?.org || 'seu workspace')}</h1>
    <p class="sub">Use sua conta de trabalho. Primeiro acesso? Abra o convite recebido por e-mail ou peça um ao administrador.</p>
    <details class="ob-illus" style="cursor:pointer">
      <summary>O que é isso?</summary>
      <p>O Corp é o KeepMind em modo organização: cada pessoa tem vault próprio, há pasta compartilhada e um painel para IA permitida, times e auditoria.</p>
    </details>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required />
    <label for="password">Senha</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />

    <p class="err" role="alert" tabindex="-1">${esc(error)}</p>
    <div class="row"><button class="btn" type="submit">Entrar</button>${sso}</div>
  </form></div>`
  if (error) document.querySelector('.err').focus()
  document.querySelector('#login')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    event.target.querySelector('button').disabled = true
    const res = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
    })
    if (!res.body.ok) {
      renderLogin(meta, COPY[res.body.error] || res.body.message || 'Não foi possível entrar.')
      return
    }
    window.location.replace('/brain/')
  })
}

async function showInvitation(token) {
  app.innerHTML = '<div class="login"><div class="card" role="status">Conferindo seu convite…</div></div>'
  const res = await api('/api/invitations/inspect', { method: 'POST', body: JSON.stringify({ token }) })
  if (!res.body.ok) {
    app.innerHTML = `<div class="login"><div class="card"><div class="mark">KeepMind Corp</div><h1>Não foi possível abrir o convite</h1><p role="alert">${esc(res.body.message || 'Peça um novo convite ao administrador.')}</p><a class="btn" href="/">Voltar para entrar</a></div></div>`
    return
  }
  const invite = res.body.invitation
  app.innerHTML = `<div class="login"><form class="card" id="accept-invite"><div class="mark">KeepMind Corp</div><h1>Entre em ${esc(invite.workspace)}</h1><p class="sub">Você recebeu acesso como ${esc(roleLabel(invite.role))}. Defina sua senha para começar.</p><p class="err" role="alert" tabindex="-1" id="invite-error"></p><label for="invite-email">E-mail corporativo</label><input id="invite-email" type="email" value="${esc(invite.email)}" readonly autocomplete="username" /><label for="invite-name">Seu nome</label><input id="invite-name" name="name" maxlength="80" autocomplete="name" required /><label for="invite-password">Senha (mínimo de 12 caracteres)</label><input id="invite-password" name="password" type="password" minlength="12" maxlength="1024" autocomplete="new-password" required /><label for="invite-confirm">Confirmar senha</label><input id="invite-confirm" name="confirm" type="password" minlength="12" maxlength="1024" autocomplete="new-password" required /><p class="sub">O convite confirma o acesso a este e-mail e só pode ser usado uma vez.</p><button class="btn" type="submit">Aceitar convite e entrar</button></form></div>`
  document.querySelector('#invite-name').focus()
  document.querySelector('#accept-invite').addEventListener('submit', async e => {
    e.preventDefault()
    const button = e.target.querySelector('button'), fields = new FormData(e.target)
    button.disabled = true; button.textContent = 'Entrando…'
    const result = await api('/api/invitations/accept', { method: 'POST', body: JSON.stringify({ token, email: invite.email, name: fields.get('name'), password: fields.get('password'), confirm: fields.get('confirm') }) })
    if (result.body.ok) return location.replace('/brain/')
    const error = document.querySelector('#invite-error'); error.textContent = result.body.message || 'Não foi possível aceitar. Tente novamente.'; error.focus()
    button.disabled = false; button.textContent = 'Aceitar convite e entrar'
  })
}
void boot()
