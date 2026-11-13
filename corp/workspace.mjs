// One organization/workspace per server and data directory. No shared tenant store.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const digest = value => createHash('sha256').update(String(value)).digest()
export const secretMatches = (a, b) => timingSafeEqual(digest(a), digest(b))
export const emailDomain = email => String(email).length <= 254 ? /^[a-z0-9][a-z0-9._%+-]{0,63}@([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i.exec(String(email))?.[1].toLowerCase() : undefined
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }) }

export function workspaceConfig(env) {
  const server = env.KEEPMIND_CORP_MODE === 'server'
  let origin = ''
  if (env.KEEPMIND_CORP_PUBLIC_URL) {
    const url = new URL(env.KEEPMIND_CORP_PUBLIC_URL)
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('KEEPMIND_CORP_PUBLIC_URL must be an HTTPS origin (HTTP only on loopback).')
    origin = url.origin
  }
  const domains = String(env.KEEPMIND_CORP_EMAIL_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (domains.some(d => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(d))) throw Error('Invalid corporate email domain.')
  if (server && (!origin || !domains.length)) throw Error('Server mode requires KEEPMIND_CORP_PUBLIC_URL and KEEPMIND_CORP_EMAIL_DOMAINS.')
  return { server, origin, domains, secure: origin.startsWith('https:') || env.KEEPMIND_CORP_SECURE === '1' }
}

export function smtpMailer(env, testTls) {
  if (!env.KEEPMIND_SMTP_HOST || !env.KEEPMIND_SMTP_FROM) return null
  const port = Number(env.KEEPMIND_SMTP_PORT || 587)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid SMTP port.')
  let transport
  const options = {
    host: env.KEEPMIND_SMTP_HOST, port, secure: port === 465,
    tls: testTls,
    requireTLS: true, // Never downgrade production SMTP to plaintext.
    auth: env.KEEPMIND_SMTP_USER ? { user: env.KEEPMIND_SMTP_USER, pass: env.KEEPMIND_SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true
  }
  return async message => {
    transport ??= (await import('nodemailer')).default.createTransport(options)
    const result = await transport.sendMail({ from: env.KEEPMIND_SMTP_FROM, ...message })
    if (!result.accepted?.length || result.rejected?.length) throw Error('SMTP did not accept recipient.')
  }
}

export function createWorkspace({ org, config, persist, addUser, audit, mailer, now = Date.now }) {
  org.invitations ??= []
  // Delivery may have completed before a crash; invalidate uncertain links and allow a fresh invite.
  for (const row of org.invitations) if (row.status === 'sending') row.status = 'failed'
  const allowed = email => {
    const domain = emailDomain(email)
    const domains = config.domains.length ? config.domains : [emailDomain(org.users.find(u => u.role === 'owner')?.email)]
    return !!domain && domains.includes(domain)
  }
  const status = row => row.status === 'pending' && row.expiresAt <= now() ? 'expired' : row.status
  const list = () => org.invitations.map(({ tokenHash, ...row }) => ({ ...row, status: status(row) }))
  const find = token => {
    if (!/^[a-f0-9]{64}$/.test(String(token))) fail('invalid_invitation', 'Convite inválido, expirado ou já utilizado.', 410)
    const hash = digest(token).toString('hex')
    const row = org.invitations.find(r => r.tokenHash === hash && status(r) === 'pending')
    const inviter = row && org.users.find(u => u.id === row.invitedBy && !u.disabled)
    if (!row || !allowed(row.email) || !inviter || !['owner','admin'].includes(inviter.role) || (row.role === 'admin' && inviter.role !== 'owner')) fail('invalid_invitation', 'Convite inválido, expirado ou já utilizado. Peça um novo convite ao administrador.', 410)
    return row
  }
  return {
    allowed, list,
    inspect(token) { const r = find(token); return { email: r.email, role: r.role, workspace: org.name, expiresAt: r.expiresAt } },
    async invite(actor, body) {
      if (!['owner', 'admin'].includes(actor.role)) fail('forbidden', 'Somente administradores podem convidar.', 403)
      if (!mailer || !config.origin) fail('mail_unavailable', 'O administrador do servidor precisa configurar SMTP e a URL pública.', 503)
      const email = String(body.email || '').trim().toLowerCase(), role = body.role || 'member'
      if (!allowed(email)) fail('email_domain', 'Use um e-mail do domínio corporativo autorizado.')
      if (!['member', 'auditor', 'admin'].includes(role) || (role === 'admin' && actor.role !== 'owner')) fail('forbidden', 'Apenas o administrador principal pode convidar outros administradores.', 403)
      if (org.users.some(u => u.email === email)) fail('member_exists', 'Essa pessoa já possui uma conta neste workspace.', 409)
      if (org.invitations.some(r => r.email === email && ['pending', 'sending'].includes(status(r)))) fail('invitation_pending', 'Já existe um convite pendente. Revogue-o antes de enviar outro.', 409)
      if (org.invitations.filter(r => r.createdAt > now() - 3600000).length >= 50) fail('rate_limited', 'Limite de convites atingido. Tente novamente em uma hora.', 429)
      const token = randomBytes(32).toString('hex')
      const row = { id: randomBytes(16).toString('hex'), email, role, createdAt: now(), expiresAt: now() + 48 * 3600000, status: 'sending', tokenHash: digest(token).toString('hex'), invitedBy: actor.id }
      org.invitations.push(row); persist()
      try {
        await mailer({ to: email, subject: `Convite para ${org.name} — KeepMind Corp`, text: `Você foi convidado para o workspace ${org.name}, com papel ${role}.\n\nAbra o link para confirmar seu e-mail e definir sua própria senha:\n${config.origin}/#invite=${token}\n\nVálido por 48 horas e para um único uso. Se não esperava este convite, ignore a mensagem.` })
      } catch {
        row.status = 'failed'; persist(); audit(actor, 'invitation_failed', { email });
        fail('mail_failed', 'O e-mail não pôde ser enviado. Confira o SMTP e tente novamente.', 502)
      }
      // A revoke during SMTP delivery must remain revoked.
      if (row.status === 'sending') row.status = 'pending'
      persist(); audit(actor, 'invitation_sent', { email, role })
      return list().find(r => r.id === row.id)
    },
    revoke(actor, id) {
      const row = org.invitations.find(r => r.id === id)
      if (!row) fail('not_found', 'Convite não encontrado.', 404)
      if (!['owner', 'admin'].includes(actor.role) || (row.role === 'admin' && actor.role !== 'owner')) fail('forbidden', 'Sem permissão para revogar este convite.', 403)
      if (['pending', 'sending'].includes(row.status)) { row.status = 'revoked'; persist(); audit(actor, 'invitation_revoked', { email: row.email }) }
    },
    accept(body) {
      const row = find(body.token)
      if (String(body.email || '').trim().toLowerCase() !== row.email) fail('email_mismatch', 'Use o mesmo e-mail que recebeu o convite.')
      if (org.users.some(u => u.email === row.email)) fail('member_exists', 'Esta conta já existe. Entre com sua senha.', 409)
      const name = String(body.name || '').trim(), password = String(body.password || '')
      if (!name || name.length > 80) fail('bad_name', 'Informe seu nome (até 80 caracteres).')
      if (password.length < 12 || password.length > 1024) fail('weak_password', 'Use uma senha entre 12 e 1024 caracteres.')
      if (password !== body.confirm) fail('mismatch', 'As senhas não conferem.')
      // No await between checking, consuming and persisting: single process/volume.
      const user = addUser({ email: row.email, name, password, role: row.role, teamId: 'everyone' })
      user.emailVerifiedAt = new Date(now()).toISOString()
      row.status = 'accepted'; row.acceptedAt = now(); persist()
      audit(user, 'invitation_accepted', { invitationId: row.id })
      return user
    }
  }
}
