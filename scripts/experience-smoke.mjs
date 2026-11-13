// Browser smoke of the built renderer. Every bridge response below is synthetic;
// no user data, provider, Electron process, or external service is accessed.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const artifacts = resolve('artifacts/experience-smoke')
await mkdir(artifacts, { recursive: true })
const report = { fixture: 'synthetic in-memory demo; no external services', checks: [], errors: [] }
const check = (name, fn) => fn().then(() => { report.checks.push({ name, result: 'passed' }); console.log(`PASS ${name}`) })
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', 'src/renderer', '--outDir', resolve('out/renderer'), '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let serverOutput = ''
server.stdout.on('data', d => { serverOutput += d.toString() })
server.stderr.on('data', d => { serverOutput += d.toString() })
let browser, page
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error(`Vite preview exited: ${serverOutput.slice(-2000)}`)
    try { const response = await fetch('http://127.0.0.1:4173/'); if (response.ok) { ready = true; break } } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  if (!ready) throw Error(`Vite preview did not start: ${serverOutput.slice(-2000)}`)
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' ? route.continue() : route.abort()
  })
  await context.addInitScript(() => {
    // All state is confined to this browser page and reset on reload.
    window.__KEEPMIND_DEMO__ = true
    window.__experienceFixture = { captureFails: true, searchFails: true, cancelled: false }
    const project = { id: 'demo-project', title: 'Projeto sintético', objective: 'Preparar uma demonstração', successCriteria: 'Uma revisão concluída', nextStep: 'Revisar a fonte', status: 'active', revision: 1, updatedAt: '2026-01-01T00:00:00Z', decisions: [], attempts: [], artifacts: [], outcomes: [], questions: [], analysisReports: [], evidence: [] }
    const config = { onboardingDone: true, ai: { provider: 'local', model: 'demo' }, localLlm: {}, github: {}, mcpServers: [], agents: [], automations: [], background: {}, autonomy: {} }
    const source = '# Fonte sintética\n\n' + 'Parágrafo de demonstração. '.repeat(220) + '\n\nMARCADOR FINAL DA FONTE COMPLETA'
    let rejectChat
    const unsubscribe = () => () => {}
    const bridge = {
      getConfig: async () => config,
      crm: async action => { if (action !== 'snapshot') throw Error('Prévia somente leitura'); return { revision:0,space:'synthetic',contacts:[],interactions:[],commitments:[],opportunities:[],drafts:[],settings:{commercialEnabled:false,autoPrepare:true,allowAutomaticSend:false},insights:[],duplicates:[],merges:[],capabilities:{canWrite:false,canConfigure:false,canSend:false,boards:[{id:'personal',label:'Prévia'}]} } },
      authState: async () => ({ needsSetup: false, user: { id: 'synthetic', name: 'Demo', email: 'demo@example.invalid' } }),
      memorySecurityStatus: async () => ({ space: 'personal', configured: true, unlocked: true }),
      automationPending: async () => [], brainFacts: async () => [], brainPolicy: async () => ({ active: 'Política sintética', proposals: [] }),
      brainHealth: async () => ({ stats: { writes7d: 1, mdFiles: 1, automationsEnabled: 0, automationsTotal: 0 } }), brainListSleep: async () => [], brainEval: async () => null,
      brainLedger: async () => [{ ts: '2026-01-01T12:00:00Z', verb: 'discovered', sentence: 'Fonte sintética registrada', path: 'notes/demo.md' }],
      continuity: async (action) => action === 'list' ? [project] : action === 'get' ? project : action === 'context' ? { text: 'Contexto sintético', analysisReports: [] } : {},
      brainCapture: async () => { if (window.__experienceFixture.captureFails) throw Error('Falha sintética'); return 'Frase guardada.' },
      brainListMemory: async () => [{ path: 'notes/demo.md', content: source }],
      brainSearch: async () => { if (window.__experienceFixture.searchFails) throw Error('Falha sintética'); return { hits: [{ path: 'notes/demo.md', title: 'Fonte sintética', snippet: 'Conteúdo de demonstração' }] } },
      brainMemoryFile: async () => source,
      brainChat: async () => new Promise((_resolve, reject) => { rejectChat = reject }),
      brainCancel: async () => { window.__experienceFixture.cancelled = true; rejectChat?.(Error('CHAT_CANCELLED')); return true },
      onBrainDelta: unsubscribe, onBrainStep: unsubscribe, onJob: unsubscribe, onActivityPush: unsubscribe, onCapture: unsubscribe, onLocalLlmProgress: unsubscribe,
      aiProviders: async () => [], localLlmStatus: async () => ({ catalog: [], config: {} }),
      automationList: async () => [], brainActivity: async () => [], brainMemoryTiers: async () => ({}), syncStatus: async () => ({}), modelsList: async () => [], onLayaProgress: unsubscribe, onUpdaterEvent: unsubscribe,
      ragStatus: async () => ({}), layaStatus: async () => ({}), updaterStatus: async () => ({}), appLaunchAtLogin: async () => ({ enabled: false }), corpSyncStatus: async () => ({}), aiCodexStatus: async () => ({ loggedIn: false })
    }
    window.sb = bridge
    console.info('Experience smoke: synthetic fixture, external requests blocked')
  })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' })
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  const go = name => nav.getByRole('button', { name, exact: true }).click()
  await check('Hoje and five primary destinations', async () => {
    await page.getByRole('heading', { name: 'Continue de onde parou' }).waitFor()
    for (const label of ['Hoje', 'Conversar', 'Projetos', 'Relacionamentos', 'Memória']) assert.equal(await nav.getByRole('button', { name: label, exact: true }).count(), 1)
    await page.getByText('Projeto sintético', { exact: true }).first().waitFor()
    await page.screenshot({ path: `${artifacts}/desktop-hoje.png`, fullPage: true })
  })
  await check('Capture failure, draft and retry', async () => {
    await page.locator('.sidebar-capture').click()
    const dialog = page.getByRole('dialog', { name: 'Capturar uma ideia' })
    const field = dialog.getByLabel('O que você quer lembrar?')
    assert.equal(await field.evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Tab')
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true)
    await field.fill('Ideia sintética para testar rascunho')
    await dialog.getByRole('button', { name: 'Guardar na memória' }).click()
    await dialog.getByRole('alert').waitFor()
    assert.equal(await field.inputValue(), 'Ideia sintética para testar rascunho')
    await page.evaluate(() => { window.__experienceFixture.captureFails = false })
    await dialog.getByRole('button', { name: 'Tentar novamente' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByText('Guardado na memória.').waitFor()
  })
  await check('Memory search failure, retry and full source', async () => {
    await go('Memória')
    await page.getByLabel('O que você quer encontrar?').fill('sintética')
    await page.getByText('A memória não pôde ser consultada.', { exact: false }).waitFor()
    await page.evaluate(() => { window.__experienceFixture.searchFails = false })
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
    await page.getByRole('button', { name: /Fonte sintética/ }).click()
    await page.getByRole('region', { name: 'Fonte completa' }).getByText('MARCADOR FINAL DA FONTE COMPLETA', { exact: false }).waitFor()
  })
  await check('Project continuation and screenshot', async () => {
    await go('Projetos')
    await page.getByRole('button', { name: /Projeto sintético/ }).click()
    await page.getByText('Preparar uma demonstração', { exact: true }).waitFor()
    await page.screenshot({ path: `${artifacts}/desktop-projeto.png`, fullPage: true })
  })
  await check('Chat running and cancellation', async () => {
    await go('Conversar')
    await page.getByLabel('Mensagem para o KeepMind').fill('Pergunta sintética')
    await page.getByRole('button', { name: 'Enviar mensagem' }).click()
    await page.getByRole('button', { name: 'Interromper', exact: true }).waitFor()
    const host = page.locator('.chat-header .keepmind-avatar__host')
    const still = host.locator('svg')
    await still.waitFor({ state: 'visible' })
    assert.ok(await still.locator('path').count() > 0 && await still.locator('use').count() > 0, 'reduced-motion avatar has no rendered geometry')
    assert.equal(await page.locator('.chat-header .keepmind-avatar__fallback').count(), 0, 'static renderer unexpectedly fell back')
    assert.equal(await host.locator('canvas').count(), 0, 'reduced-motion avatar should use a static SVG')
    const stillMarkup = await still.evaluate(el => el.outerHTML)
    await page.waitForTimeout(250)
    assert.equal(await still.evaluate(el => el.outerHTML), stillMarkup, 'reduced-motion avatar changed while idle')
    // The live renderer must also work when the system allows motion.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const canvas = host.locator('canvas')
    await canvas.waitFor({ state: 'visible' })
    assert.ok(await canvas.evaluate(el => el.width > 0 && el.height > 0), 'avatar canvas has no bitmap')
    await page.waitForFunction(() => {
      const el = document.querySelector('.chat-header .keepmind-avatar__host canvas')
      if (!el) return false
      const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) return true
      return false
    }, null, { timeout: 5000 })
    const firstFrame = await canvas.evaluate(el => el.toDataURL())
    await page.waitForFunction(previous => {
      const el = document.querySelector('.chat-header .keepmind-avatar__host canvas')
      return el && el.toDataURL() !== previous
    }, firstFrame, { timeout: 5000 })
    assert.equal(await page.locator('.chat-header .keepmind-avatar__fallback').count(), 0, 'live renderer unexpectedly fell back')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await host.locator('svg').waitFor({ state: 'visible' })
    assert.equal(await host.locator('canvas').count(), 0, 'avatar did not return to the static renderer')
    await page.screenshot({ path: `${artifacts}/desktop-chat.png`, fullPage: true })
    await page.getByRole('button', { name: 'Interromper', exact: true }).click()
    await page.getByText('Geração interrompida.', { exact: false }).waitFor()
    assert.equal(await page.evaluate(() => window.__experienceFixture.cancelled), true)
  })
  await check('Reduced motion and avatar preference', async () => {
    assert.equal(await page.locator('html').getAttribute('data-motion'), 'reduced')
    await page.getByRole('button', { name: 'Ferramentas e configurações' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: /Configurações/ }).click()
    const avatar = page.getByLabel('Mostrar avatar do KeepMind')
    await avatar.uncheck()
    assert.equal(await avatar.isChecked(), false)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('keepmind:appearance')).avatarEnabled), false)
    assert.equal(await page.locator('.keepmind-avatar').count(), 0)
  })
  await check('Relacionamentos navigation', async () => {
    await go('Relacionamentos')
    await page.getByRole('heading', { name: 'Cuide das suas relações' }).waitFor()
    await page.getByText('Sua agenda').waitFor()
  })
  await check('Rotinas navigation', async () => {
    await page.getByRole('button', { name: 'Ferramentas e configurações' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: /Rotinas/ }).click()
    await page.getByRole('heading', { name: 'Rotinas', exact: true }).waitFor()
  })
  await check('Narrow viewport navigation and focus', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const compact = page.getByRole('navigation', { name: 'Navegação compacta' })
    await compact.getByRole('button', { name: 'Hoje', exact: true }).click()
    await page.getByRole('heading', { name: 'Continue de onde parou' }).waitFor()
    await compact.getByRole('button', { name: 'Memória', exact: true }).focus()
    assert.equal(await compact.getByRole('button', { name: 'Memória', exact: true }).evaluate(el => el === document.activeElement), true)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflows narrow viewport')
    await page.screenshot({ path: `${artifacts}/mobile-hoje.png`, fullPage: true })
  })
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`)
} catch (error) {
  report.errors.push(String(error?.stack ?? error))
  console.error(report.errors.at(-1))
  if (page) await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  server.kill('SIGTERM')
  await writeFile(`${artifacts}/report.json`, JSON.stringify(report, null, 2) + '\n')
}
