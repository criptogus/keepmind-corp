// Used by the existing CRM/Corp batch. Real HTTP + SMTP STARTTLS; only temporary data.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { SMTPServer } from 'smtp-server'
import { createCorp } from '../corp/server.mjs'
import { smtpMailer } from '../corp/workspace.mjs'

export async function workspaceSmoke({ browser, root, artifacts, check }) {
  const directory = path.join(root, 'workspace'); await mkdir(directory)
  const key = path.join(directory, 'smtp-key.pem'), cert = path.join(directory, 'smtp-cert.pem')
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'], { stdio: 'ignore' })
  const certificate = await readFile(cert), messages = []
  const smtp = new SMTPServer({ key: await readFile(key), cert: certificate, authOptional: true, disabledCommands: ['AUTH'], onData(stream, session, done) { let text = ''; stream.on('data', c => { text += c }); stream.on('end', () => { messages.push({ text, tls: session.secure }); done() }) } })
  let server, context, invited
  try {
    await new Promise((r,j) => { smtp.on('error', j); smtp.listen(0, '127.0.0.1', r) })
    let corp
    server = createServer((req,res) => corp.handle(req,res)); await new Promise(r => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}`
    const setupToken = 'synthetic-install-key-'.repeat(4)
    const env = { KEEPMIND_CORP_MODE:'server', KEEPMIND_CORP_PUBLIC_URL:base, KEEPMIND_CORP_EMAIL_DOMAINS:'aurora.test', KEEPMIND_CORP_SETUP_TOKEN:setupToken }
    const mailer = smtpMailer({ KEEPMIND_SMTP_HOST:'127.0.0.1', KEEPMIND_SMTP_PORT:String(smtp.server.address().port), KEEPMIND_SMTP_FROM:'corp@aurora.test' }, { ca: certificate, servername:'localhost' })
    corp = createCorp({ dataDir:path.join(directory,'data'), env, mailer, disableCrmScheduler:true, disableGithubScheduler:true, oidc:false })
    context = await browser.newContext({ viewport:{width:1024,height:640}, reducedMotion:'reduce' })
    await context.route('**/*', r => new URL(r.request().url()).origin === base ? r.continue() : r.abort())
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000)
    await check('VPS workspace: protected first administrator and keyboard-ready setup', async () => {
      await page.goto(base)
      await page.getByRole('button',{name:'Começar configuração'}).click()
      await page.getByRole('alert').filter({hasText:'Informe a chave'}).waitFor()
      assert.equal(await page.locator('#form-error').evaluate(e => e === document.activeElement),true)
      await page.getByLabel('Chave de instalação').fill(setupToken)
      await page.getByRole('button',{name:'Começar configuração'}).click()
      await page.getByLabel('Nome da organização').fill('Aurora — Workspace')
      await page.getByRole('button',{name:'Continuar',exact:true}).click()
      await page.getByLabel('Seu nome',{exact:true}).fill('Admin Aurora')
      await page.getByLabel('Email de trabalho').fill('owner@aurora.test')
      await page.getByRole('button',{name:'Continuar',exact:true}).click()
      await page.getByLabel('Senha',{exact:true}).fill('synthetic-owner-password')
      await page.getByLabel('Confirmar senha').fill('synthetic-owner-password')
      await page.getByRole('button',{name:'Criar organização e entrar'}).click()
      await page.waitForURL('**/brain/')
      await page.goto(base+'/admin/')
      await page.getByRole('button',{name:'Pessoas',exact:true}).click()
      await page.getByRole('heading',{name:'Convide sua equipe'}).waitFor()
    })
    let link
    await check('VPS workspace: corporate invitation delivered via SMTP STARTTLS', async () => {
      await page.getByLabel('E-mail corporativo').fill('ana@other.test')
      await page.getByRole('button',{name:'Enviar convite',exact:true}).click()
      await page.getByRole('alert').filter({hasText:'domínio corporativo'}).waitFor()
      assert.equal(messages.length,0)
      await page.getByLabel('E-mail corporativo').fill('ana@aurora.test')
      await page.getByRole('button',{name:'Enviar convite',exact:true}).click()
      await page.getByText('Convite enviado por e-mail.',{exact:true}).waitFor()
      assert.equal(messages.length,1); assert.equal(messages[0].tls,true)
      // Decode MIME quoted-printable soft wrapping used by Nodemailer.
      const text = messages[0].text.replace(/=\r?\n/g,'').replace(/=([A-F0-9]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)))
      link = text.match(/http:\/\/127\.0\.0\.1:\d+\/#invite=[a-f0-9]{64}/)?.[0]
      assert.ok(link, 'SMTP message must contain the canonical invitation URL')
      await page.screenshot({path:path.join(artifacts,'workspace-invitations.png'),fullPage:true})
    })
    await check('VPS workspace: recipient acceptance, login and single use at compact size', async () => {
      invited = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
      await invited.route('**/*', r => new URL(r.request().url()).origin === base ? r.continue() : r.abort())
      const member = await invited.newPage(); member.on('pageerror', e => errors.push(e.message))
      await member.goto(link)
      await member.getByRole('heading',{name:'Entre em Aurora — Workspace'}).waitFor()
      assert.equal(await member.url(),base+'/')
      assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true)
      assert.equal(await member.locator('.card').evaluate(e=>getComputedStyle(e).animationName),'none')
      await member.screenshot({path:path.join(artifacts,'workspace-invitation-mobile.png'),fullPage:true})
      await member.getByLabel('Seu nome',{exact:true}).fill('Ana Aurora')
      await member.getByLabel('Senha (mínimo de 12 caracteres)').fill('synthetic-member-password')
      await member.getByLabel('Confirmar senha').fill('different-password')
      await member.getByRole('button',{name:'Aceitar convite e entrar'}).click()
      await member.getByRole('alert').filter({hasText:'não conferem'}).waitFor()
      assert.equal(await member.getByLabel('Seu nome',{exact:true}).inputValue(),'Ana Aurora')
      await member.getByLabel('Confirmar senha').fill('synthetic-member-password')
      await member.getByRole('button',{name:'Aceitar convite e entrar'}).click(); await member.waitForURL('**/brain/')
      const forbidden = await invited.request.get(base+'/api/members'); assert.equal(forbidden.status(),403)
      await member.goto(link); await member.getByRole('heading',{name:'Não foi possível abrir o convite'}).waitFor()
      await invited.request.post(base+'/api/logout',{headers:{Origin:base}})
      await member.goto(base); await member.getByLabel('Email',{exact:true}).fill('ana@aurora.test'); await member.getByLabel('Senha',{exact:true}).fill('synthetic-member-password'); await member.getByRole('button',{name:'Entrar',exact:true}).click(); await member.waitForURL('**/brain/')
      assert.deepEqual(errors,[])
    })
  } finally {
    await invited?.close(); await context?.close()
    if (server) await new Promise(r=>server.close(r))
    await new Promise(r=>smtp.close(r))
  }
}
