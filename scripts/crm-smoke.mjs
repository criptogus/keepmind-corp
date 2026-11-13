// Real Corp HTTP server and CRM service, backed only by a temporary synthetic vault.
// No providers, personal data, or external browser requests are used.
import assert from 'node:assert/strict'
import { workspaceSmoke } from './corp-workspace-smoke.mjs'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { createCorp } from '../corp/server.mjs'

process.env.TZ = 'UTC'
const artifacts = path.resolve('artifacts/crm-smoke')
await mkdir(artifacts, { recursive: true })
const report = { fixture: 'synthetic temporary Corp vault, real CRM service, rules-only extraction', checks: [], errors: [] }
const check = async (name, fn) => { await fn(); report.checks.push({ name, result: 'passed' }); console.log(`PASS ${name}`) }
const root = await mkdtemp(path.join(tmpdir(), 'keepmind-crm-smoke-'))
let server, browser, page
try {
  const corp = createCorp({ dataDir:path.join(root,'data'), vault:path.join(root,'vault'), disableGithubScheduler:true, disableCrmScheduler:true, oidc:false, env:{} })
  server = createServer((req,res) => corp.handle(req,res).catch(error => { if (!res.headersSent) res.writeHead(500,{'content-type':'application/json'}); res.end(JSON.stringify({error:error.code || 'server_error',message:error.message})) }))
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve) })
  const base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless:true, ...(process.env.CRM_SMOKE_CHROMIUM ? { executablePath: process.env.CRM_SMOKE_CHROMIUM } : {}) })
  const context = await browser.newContext({ viewport:{width:1440,height:900}, reducedMotion:'reduce' })
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort())
  const headers = {'content-type':'application/json','x-keepmind-corp':'1'}
  const setup = await context.request.post(`${base}/api/setup`,{headers,data:{orgName:'Organização sintética',name:'Teste',email:'owner@example.invalid',password:'synthetic-password-123',confirm:'synthetic-password-123'}})
  assert.equal(setup.status(),201,await setup.text())
  const userId=(await setup.json()).user.id
  const config = await context.request.patch(`${base}/api/brain/config`,{headers,data:{onboardingDone:true}})
  assert.ok(config.ok(),await config.text())
  const crm = async (action, args={}) => {
    const res = action==='snapshot' ? await context.request.get(`${base}/api/crm?board=${encodeURIComponent(args.board || 'personal')}`) : await context.request.post(`${base}/api/crm`,{headers,data:{action,args}})
    const body=await res.json(); assert.ok(res.ok(),JSON.stringify(body)); return body
  }
  const mutate = async (action,args={}) => { const s=await crm('snapshot',{board:args.board}); return crm(action,{...args,expectedRevision:s.revision}) }
  page=await context.newPage(); page.setDefaultTimeout(15000)
  const errors=[]; page.on('pageerror', e=>errors.push(e.message))
  await page.goto(`${base}/brain/`,{waitUntil:'domcontentloaded'})
  const nav=page.getByRole('navigation',{name:'Navegação principal'})
  const go=async name=>{ const narrow=page.viewportSize().width <= 700; const target=narrow?page.getByRole('navigation',{name:'Navegação compacta'}):nav; await target.getByRole('button',{name,exact:true}).click() }
  await check('create contact with only a name',async()=>{
    await go('Relacionamentos'); await page.getByRole('heading',{name:'Cuide das suas relações'}).waitFor()
    await page.getByRole('button',{name:'Adicionar pessoa'}).click()
    await page.getByLabel('Nome',{exact:true}).fill('Ana Sintética')
    await page.getByRole('button',{name:'Salvar',exact:true}).click(); await page.getByText('Contato salvo.').waitFor()
    const snapshot=await crm('snapshot'); assert.equal(snapshot.contacts.find(c=>c.name==='Ana Sintética')?.email,'')
    await page.screenshot({path:`${artifacts}/desktop-crm.png`,fullPage:true})
  })
  await check('natural-language capture and relative date',async()=>{
    await page.getByRole('button',{name:'Hoje',exact:true}).last().click()
    await page.getByLabel('Relacionar a alguém (opcional)').selectOption({label:'Ana Sintética'})
    await page.getByLabel('O que aconteceu?').fill('Conversei com Ana Sintética. Prometi enviar a proposta amanhã.')
    await page.getByRole('button',{name:'Registrar',exact:true}).click()
    await page.getByText('Captura registrada.').waitFor()
    const snap=await crm('snapshot'); const c=snap.contacts.find(x=>x.name==='Ana Sintética'); const item=snap.commitments.find(x=>x.contactId===c.id)
    assert.ok(item && item.title.includes('enviar a proposta'),JSON.stringify(item))
    const tomorrow=new Date();tomorrow.setUTCDate(tomorrow.getUTCDate()+1);assert.equal(item.dueAt.slice(0,10),tomorrow.toISOString().slice(0,10))
  })
  await check('detail, sourced history and local draft',async()=>{
    let snap=await crm('snapshot'); const c=snap.contacts.find(x=>x.name==='Ana Sintética')
    const file=path.join(corp.vault,'people',userId,'memory','notes','fonte.md');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'# Fonte sintética\nConteúdo para teste.\n')
    await mutate('record_interaction',{contactId:c.id,channel:'meeting',direction:'internal',body:'Histórico sintético completo.',source:{path:'notes/fonte.md'}})
    await go('Hoje'); await go('Relacionamentos'); await page.getByRole('button',{name:'Pessoas',exact:true}).click()
    await page.getByRole('button',{name:/Ana Sintética/}).click()
    await page.getByText('Histórico sintético completo.').waitFor(); await page.getByRole('button',{name:/Abrir fonte: notes\/fonte.md/}).waitFor()
    await page.getByRole('button',{name:'Preparar rascunho'}).click()
    const draft=page.getByLabel('Mensagem',{exact:true}); await draft.fill('Mensagem de demonstração revisada.')
    await page.getByRole('button',{name:'Salvar rascunho'}).click(); await page.getByText('Rascunho salvo.').waitFor()
    snap=await crm('snapshot'); assert.equal(snap.drafts[0].body,'Mensagem de demonstração revisada.');assert.equal(snap.drafts[0].status,'draft')
    assert.equal(await page.getByRole('button',{name:/^Enviar (email|whatsapp)$/}).count(),0)
    await page.screenshot({path:`${artifacts}/desktop-contato.png`,fullPage:true})
  })
  await check('revision conflict preserves draft and retry',async()=>{
    const field=page.getByLabel('Mensagem',{exact:true});await field.fill('Texto preservado durante conflito.')
    // A real intervening write advances the stored revision before the UI saves.
    const snap=await crm('snapshot');const c=snap.contacts.find(x=>x.name==='Ana Sintética')
    await mutate('update_contact',{contactId:c.id,notes:'Alteração concorrente sintética'})
    await page.getByRole('button',{name:'Salvar rascunho'}).click()
    await page.getByRole('alert').getByText(/Os dados mudaram/).waitFor();assert.equal(await field.inputValue(),'Texto preservado durante conflito.')
    await page.getByRole('button',{name:'Salvar rascunho'}).click();await page.getByText('Rascunho salvo.').waitFor()
    assert.equal((await crm('snapshot')).drafts[0].body,'Texto preservado durante conflito.')
  })
  await check('commercial mode and opportunity stage',async()=>{
    await page.getByText('Configurações e revisão').click();await page.getByLabel('Recursos comerciais').selectOption('true'); await page.getByText('Configurações atualizadas.').waitFor()
    await page.getByRole('button',{name:'Oportunidades',exact:true}).click();await page.getByRole('button',{name:'Nova oportunidade'}).click()
    await page.getByLabel('Nome',{exact:true}).fill('Projeto sintético');await page.getByLabel('Contato',{exact:true}).selectOption({label:'Ana Sintética'});await page.getByRole('button',{name:'Criar oportunidade'}).click(); await page.getByText('Oportunidade criada.').waitFor()
    await page.getByLabel('Etapa').selectOption('proposal'); await page.getByText('Etapa atualizada.').waitFor();assert.equal((await crm('snapshot')).opportunities[0].stage,'proposal')
  })
  await check('personal and team boards remain isolated',async()=>{
    await page.getByLabel('Espaço de relacionamentos').selectOption('team');await page.getByRole('button',{name:'Pessoas',exact:true}).click()
    assert.equal(await page.getByRole('button',{name:/Ana Sintética/}).count(),0)
    await page.getByRole('button',{name:'Adicionar',exact:true}).click();await page.getByLabel('Nome',{exact:true}).fill('Equipe Sintética');await page.getByRole('button',{name:'Salvar',exact:true}).click();await page.getByText('Contato salvo.').waitFor()
    assert.ok((await crm('snapshot',{board:'team'})).contacts.some(c=>c.name==='Equipe Sintética'))
    await page.getByLabel('Espaço de relacionamentos').selectOption('personal');await page.getByRole('button',{name:'Pessoas',exact:true}).click()
    assert.equal(await page.getByRole('button',{name:/Equipe Sintética/}).count(),0);await page.getByRole('button',{name:/Ana Sintética/}).waitFor()
  })
  await check('mobile width and agenda on Hoje',async()=>{
    const snap=await crm('snapshot'); const contact=snap.contacts.find(x=>x.name==='Ana Sintética'); await mutate('create_commitment',{contactId:contact.id,title:'Contato urgente sintético',dueAt:new Date().toISOString().slice(0,10),waitingOn:'me'}); await page.setViewportSize({width:390,height:844});await go('Hoje');await page.getByRole('heading',{name:'Continue de onde parou'}).waitFor()
    await page.getByRole('heading',{name:'Próximos contatos'}).waitFor(); await page.getByText(/Contato urgente sintético/).waitFor()
    await go('Relacionamentos');await page.getByRole('heading',{name:'Cuide das suas relações'}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), 'horizontal overflow at 390px')
    await page.screenshot({path:`${artifacts}/mobile-crm.png`,fullPage:true})
  })
  assert.deepEqual(errors,[],'Uncaught browser errors')
  await workspaceSmoke({ browser, root, artifacts, check })
} catch (error) {
  report.errors.push(String(error?.stack ?? error));console.error(error)
  if(page) await page.screenshot({path:`${artifacts}/failure.png`,fullPage:true}).catch(()=>{})
  process.exitCode=1
} finally {
  await browser?.close().catch(()=>{})
  if(server?.listening) await new Promise(resolve=>server.close(resolve))
  await rm(root,{recursive:true,force:true})
  await writeFile(path.join(artifacts,'report.json'),JSON.stringify(report,null,2)+'\n')
}
