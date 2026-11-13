// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Memory } from '../src/main/services/brain/memory-store'
import { createContinuityService } from '../src/main/services/continuity'
import Projects from '../src/renderer/src/components/Projects'
import AnswerBenchmark from '../src/renderer/src/components/AnswerBenchmark'
import { runAnswerBenchmark } from '../src/main/services/answer-benchmark'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let dir = ''
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const button = (text: string, parent: ParentNode = document) => [...parent.querySelectorAll('button')].find(x => x.textContent?.trim() === text) as HTMLButtonElement
const section = (title: string) => [...document.querySelectorAll('section')].find(x => x.querySelector('h2')?.textContent === title)!
async function click(b: HTMLElement) { expect(b).toBeTruthy(); await act(async () => { b.click() }); await flush() }
async function field(label: string, value: string) {
  const l = [...document.querySelectorAll('label')].find(x => x.querySelector('span')?.textContent === label)!
  const input = l?.querySelector('textarea,input,select') as HTMLInputElement
  expect(input, `field ${label}`).toBeTruthy()
  await act(async () => { Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
async function mount(component: React.ReactNode) { const el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el); await act(async () => { root!.render(component) }); await flush() }
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.innerHTML = ''; if (dir) rmSync(dir, { recursive:true, force:true }); dir = '' })

describe('continuity renderer with fictional filesystem vault', () => {
  it('creates and reviews a decision, links an artifact, confirms a lesson and reviews a stale analysis', async () => {
    dir = mkdtempSync(join(tmpdir(),'keepmind-ui-')); const memory = new Memory(dir, null, { allowPlaintext:true }); memory.write('notes/fonte.md','Prazo em junho.'); const service = createContinuityService(memory)
    ;(window as any).sb = { continuity: async (a: string, args: any) => service.dispatch(a,args,'human'), brainSearch: async () => ({hits:[]}), memorySecurityStatus: async () => ({space:'personal'}), projectAnalyze: async (args: any) => service.analyze(args, async ({user}: any) => { const input=JSON.parse(user); return JSON.stringify({summary:'Prazos diferentes',findings:[{decisionId:input.decisions[0].id,relationship:'possible_contradiction',explanation:'Datas diferem',sourcePath:'notes/fonte.md',quote:'Prazo em junho.'}],outcomeAssessments:[]}) }, {provider:'test',model:'fixture'}) }
    await mount(<Projects />)
    await field('Nome do projeto','Teste'); await field('Objetivo','Objetivo'); await field('Como saberemos que deu certo?','Critério'); await field('Próximo passo','Próximo')
    await click(button('Salvar')); expect(document.body.textContent).toContain('Teste')
    await click(button('Adicionar', section('Decisões'))); await field('Decisão','Entregar em maio'); await field('Caminhos de evidência','notes/fonte.md'); await click(button('Salvar',section('Decisões')))
    await click(button('Aceitar',section('Decisões'))); await field('Motivo da revisão','Aprovada'); await click(button('Confirmar',section('Decisões')))
    let project = service.dispatch('list')[0]; expect(project.decisions[0].status).toBe('accepted'); expect(project.decisions[0].reviews[0].reason).toBe('Aprovada')
    await click(button('Adicionar',section('Artefatos'))); await field('Artefato','Relatório'); await field('Caminho de memória (.md)','notes/relatorio.md'); const checkbox = [...section('Artefatos').querySelectorAll('label')].find(l => l.textContent?.includes('Entregar em maio'))!.querySelector('input')!; await click(checkbox); await click(button('Salvar',section('Artefatos')))
    project=service.dispatch('list')[0]; expect(project.artifacts[0].decisionIds).toEqual([project.decisions[0].id])
    project=service.dispatch('record_outcome',{projectId:project.id,expectedRevision:project.revision,decisionId:project.decisions[0].id,executionStatus:'completed',observedResult:'Junho',lesson:'Rever prazo'},'agent')
    await click(button('← Todos os projetos')); await click([...document.querySelectorAll('button')].find(b => b.querySelector('strong')?.textContent === 'Teste')!); await click(button('Confirmar lição',section('Resultados e lições'))); await field('Motivo da revisão','Conferida'); await click(button('Confirmar',section('Resultados e lições')))
    project=service.dispatch('list')[0]; expect(project.outcomes).toHaveLength(1); expect(project.outcomes[0].lessonConfirmed).toBe(true)
    await click(button('Analisar fontes')); expect(document.body.textContent).toContain('Possível contradição'); expect(document.body.textContent).toContain('Proposta')
    await click(button('Confirmar',section('Análise de continuidade'))); await field('Motivo da revisão','Comparei a fonte'); await click(button('Salvar revisão',section('Análise de continuidade')))
    project=service.dispatch('list')[0]; expect(project.analysisReports[0].findings[0].status).toBe('confirmed')
    memory.write('notes/fonte.md','Prazo em julho.'); await click(button('← Todos os projetos')); await click([...document.querySelectorAll('button')].find(b => b.querySelector('strong')?.textContent === 'Teste')!); expect(document.body.textContent).toContain('Desatualizada'); expect(button('Confirmar', section('Análise de continuidade'))).toBeUndefined()
  })
})

describe('progressive continuity flows', () => {
  it('creates with only name and objective, attaches selected sources and keeps search failures visible', async () => {
    dir = mkdtempSync(join(tmpdir(), 'keepmind-ui-')); const memory = new Memory(dir, null, { allowPlaintext: true }); memory.write('notes/source.md', 'Uma fonte.'); const service = createContinuityService(memory)
    let fail = true
    ;(window as any).sb = { continuity: async (a: string, args: any) => service.dispatch(a, args, 'human'), brainSearch: async () => fail ? { error: 'Busca indisponível' } : { hits: [{ path: 'notes/source.md', title: 'Fonte' }], notice: 'Busca por texto' }, memorySecurityStatus: async () => ({ space: 'personal' }) }
    await mount(<Projects />)
    await field('Nome do projeto', 'Projeto curto'); await field('Objetivo', 'Retomar trabalho')
    const search = document.querySelector('#source-search') as HTMLInputElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'fonte'); search.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(button('Buscar')); expect(document.body.textContent).toContain('Busca indisponível')
    fail = false; await click(button('Buscar')); expect(document.body.textContent).toContain('Busca por texto')
    await click(document.querySelector('.continuity-hit input') as HTMLElement); await click(button('Salvar'))
    const project = service.dispatch('list')[0]; expect(project.successCriteria).toBe(''); expect(project.nextStep).toBe(''); expect(project.evidence[0].path).toBe('notes/source.md')
    expect(document.body.textContent).toContain('Ainda não definido.')
  })
  it('selects an artifact in the active space and offers the full handoff to the conversation', async () => {
    dir = mkdtempSync(join(tmpdir(), 'keepmind-ui-')); const memory = new Memory(dir, null, { allowPlaintext: true }); memory.write('notes/source.md', 'Fonte.'); const service = createContinuityService(memory)
    const project = service.dispatch('create', { title: 'Projeto', objective: 'Objetivo', successCriteria: '', nextStep: '' }, 'human')
    const resume = vi.fn()
    ;(window as any).sb = { continuity: async (a: string, args: any) => service.dispatch(a, args, 'human'), brainSearch: async () => ({ hits: [{ path: 'notes/source.md', title: 'Fonte' }, { path: 'spaces/other/private.md', title: 'Outro espaço' }] }), memorySecurityStatus: async () => ({ space: 'personal' }) }
    await mount(<Projects initialProjectId={project.id} onResume={resume} />)
    await click(button('Adicionar', section('Artefatos'))); await field('Artefato', 'Relatório'); await field('Buscar memória', 'fonte'); await click(button('Buscar fonte'))
    expect(section('Artefatos').textContent).not.toContain('Outro espaço')
    await click(button('Selecionar', section('Artefatos'))); expect((section('Artefatos').querySelectorAll('textarea')[1] as HTMLTextAreaElement).value).toBe('notes/source.md')
    await click(button('Salvar', section('Artefatos'))); expect(service.dispatch('list')[0].artifacts[0].path).toBe('notes/source.md')
    await click(button('Retomar contexto')); await click(button('Usar na conversa')); expect(resume).toHaveBeenCalledOnce(); expect(resume.mock.calls[0][0]).toContain('Project handoff')
  })
  it('does not accept an outdated search response or submit the same draft twice', async () => {
    let resolveSearch!: (result: any) => void; let resolveCreate!: (result: any) => void
    const create = vi.fn(() => new Promise(resolve => { resolveCreate = resolve }))
    ;(window as any).sb = { continuity: async (action: string) => action === 'list' ? [] : action === 'create' ? create() : {}, brainSearch: () => new Promise(resolve => { resolveSearch = resolve }), memorySecurityStatus: async () => ({ space: 'personal' }) }
    await mount(<Projects />); await field('Nome do projeto', 'Teste'); await field('Objetivo', 'Objetivo')
    const input = document.querySelector('#source-search') as HTMLInputElement
    const changeSearch = async (value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
    await changeSearch('primeira'); await click(button('Buscar')); await changeSearch('segunda')
    await act(async () => { resolveSearch({ hits: [{ path: 'old.md', title: 'Antigo' }] }); await Promise.resolve() }); expect(document.body.textContent).not.toContain('Antigo')
    const form = button('Salvar').closest('form')!; await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); expect(create).toHaveBeenCalledOnce()
    await act(async () => { resolveCreate({ id: 'p', title: 'Teste', objective: 'Objetivo', decisions: [] }); await Promise.resolve() })
  })
  it('opens the requested project and retains a draft when switching editors', async () => {
    dir = mkdtempSync(join(tmpdir(), 'keepmind-ui-')); const memory = new Memory(dir, null, { allowPlaintext: true }); const service = createContinuityService(memory)
    const project = service.dispatch('create', { title: 'Abrir direto', objective: 'Objetivo', successCriteria: '', nextStep: '' }, 'human')
    ;(window as any).sb = { continuity: async (a: string, args: any) => service.dispatch(a, args, 'human') }
    await mount(<Projects initialProjectId={project.id} />); expect(document.body.textContent).toContain('Abrir direto')
    await click(button('Adicionar', section('Decisões'))); await field('Decisão', 'Rascunho')
    await click(button('Adicionar', section('Questões em aberto'))); await click(button('Adicionar', section('Decisões')))
    expect((section('Decisões').querySelector('textarea') as HTMLTextAreaElement).value).toBe('Rascunho')
  })
})

describe('answer benchmark renderer', () => {
  it('distinguishes a failed history load from an empty history', async () => {
    ;(window as any).sb = { answerBenchmarkList: async () => { throw new Error('Histórico indisponível') } }
    await mount(<AnswerBenchmark />)
    expect(document.body.textContent).toContain('Histórico indisponível')
    expect(document.body.textContent).not.toContain('Nenhuma execução registrada')
  })

  it('shows errors, cancellation, history and only compatible comparisons', async () => {
    // The service is real; the completion callback is a controllable test double, not an accuracy test.
    const initial = await runAnswerBenchmark({ provider:'test', model:'fixture', maxCalls:0, complete:async () => 'not called' })
    const report = (id:string, fingerprint:string) => ({...initial,id,suiteFingerprint:fingerprint})
    const history = [report('a','same'),report('b','same'),report('c','different')]
    let controller: AbortController
    let failNext = false
    let progress: (event: { completed: number; total: number; calls: number }) => void = () => {}
    ;(window as any).sb = { onBenchmarkProgress: (callback: typeof progress) => { progress = callback; return () => { progress = () => {} } }, answerBenchmarkList: async () => history, answerBenchmarkRun: async () => {
      if (failNext) throw new Error('Falha do provedor')
      controller = new AbortController()
      const result = await runAnswerBenchmark({provider:'test',model:'fixture',signal:controller.signal,complete:({signal}) => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('cancelled'))))})
      history.unshift(result); return result
    }, answerBenchmarkCancel: async () => { controller.abort(); return true } }
    await mount(<AnswerBenchmark />); expect(document.querySelector('.continuity-benchmark-case')?.hasAttribute('open')).toBe(false); const selects=document.querySelectorAll('select'); expect(selects[1].options).toHaveLength(2)
    await click(button('Rodar benchmark')); expect(button('Cancelar execução')).toBeTruthy(); await act(async () => progress({ completed: 2, total: 6, calls: 4 })); expect(document.body.textContent).toContain('2 de 6 casos concluídos · 4 chamadas'); await click(button('Cancelar execução')); expect(document.body.textContent).toContain('Cancelado')
    failNext = true; await click(button('Rodar benchmark')); expect(document.body.textContent).toContain('Falha do provedor')
  })
})
