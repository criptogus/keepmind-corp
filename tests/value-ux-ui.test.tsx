// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import Chat from '../src/renderer/src/components/Chat'
import Projects from '../src/renderer/src/components/Projects'
import Today from '../src/renderer/src/components/Today'
import Memory from '../src/renderer/src/components/Memory'
vi.mock('open-bot-avatar/dom', () => ({ mountAvatar: () => ({ update() {}, destroy() {} }) }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
async function mount(element: React.ReactNode) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(element)); await flush() }
async function flush(ms = 0) { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
async function click(el: HTMLElement) { expect(el).toBeTruthy(); await act(async () => el.click()); await flush() }
async function select(value: string) { await act(async () => { const el = document.querySelector('select')!; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })) }) }
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.innerHTML = ''; localStorage.clear(); vi.restoreAllMocks() })
const project = { id:'p1', title:'Proposta Aurora', objective:'Preparar apresentação', nextStep:'Revisar escopo', status:'active', updatedAt:'2026-11-13T12:00:00Z', decisions:[{ id:'d1', choice:'Escopo aprovado', status:'accepted', createdAt:'2026-11-12' },{ id:'d2', choice:'Hipótese nova', status:'proposed', createdAt:'2026-11-13' }], evidence:[{path:'notes/reuniao.md'}], outcomes:[], questions:[], analysisReports:[] }
it('prepares useful prompts without sending or replacing a draft silently', async () => {
 const send = vi.fn(); (window as any).sb = { brainChat:send, onBrainDelta:()=>()=>{}, onBrainStep:()=>()=>{} }
 await mount(<Chat initialPrompt={{id:1,text:'Rascunho importante'}} />)
 await click(button('Retomar um projeto →'))
 expect(document.querySelector('textarea')!.value).toBe('Rascunho importante')
 expect(send).not.toHaveBeenCalled()
 await click(button('Usar mensagem sugerida'))
 expect(document.querySelector('textarea')!.value).toContain('cite as fontes')
 expect(send).not.toHaveBeenCalled()
})
it('distinguishes reported sources from unsupported answers and opens the exact source', async () => {
 localStorage.setItem('sb-chat:brain', JSON.stringify([{role:'assistant',content:'Uma resposta', memories:['notes/reuniao.md']},{role:'assistant',content:'Outra resposta'}]))
 ;(window as any).sb = { onBrainDelta:()=>()=>{}, onBrainStep:()=>()=>{} }
 const open = vi.fn(); await mount(<Chat onOpenMemory={open} />)
 expect(document.body.textContent).toContain('Nenhuma fonte informada nesta resposta')
 expect(document.body.textContent).toContain('não confirma, sozinha, toda a resposta')
 await click(document.querySelector('.source-link') as HTMLElement)
 expect(open).toHaveBeenCalledWith('notes/reuniao.md')
})
it('does not pull the reader back down when a streamed answer changes', async () => {
 let delta: (text:string,id?:string)=>void = ()=>{}; let resolve!: (value:any)=>void
 const send = vi.fn(()=>new Promise(r=>{resolve=r})); const scroll=vi.spyOn(HTMLElement.prototype,'scrollIntoView').mockImplementation(()=>{})
 ;(window as any).sb={brainChat:send,onBrainDelta:(cb:typeof delta)=>{delta=cb;return()=>{}},onBrainStep:()=>()=>{}}
 await mount(<Chat initialPrompt={{id:1,text:'Pergunta'}} />); await click(document.querySelector('[aria-label="Enviar mensagem"]') as HTMLElement)
 const area=document.querySelector('.chat-messages')!
 Object.defineProperties(area,{scrollHeight:{value:1600,configurable:true},clientHeight:{value:400,configurable:true},scrollTop:{value:100,writable:true,configurable:true}})
 await act(async()=>area.dispatchEvent(new Event('scroll',{bubbles:true}))); scroll.mockClear()
 await act(async()=>delta('Resposta parcial'))
 expect(scroll).not.toHaveBeenCalled(); expect(button('Ir para a resposta mais recente ↓')).toBeTruthy()
 await click(button('Ir para a resposta mais recente ↓')); expect(scroll).toHaveBeenCalledOnce()
 await act(async()=>resolve({text:'Resposta concluída'}))
})
it('filters projects without confusing proposed decisions with accepted ones and preserves source identity', async () => {
 const open = vi.fn(); const resume = vi.fn(); const api=vi.fn(async(action:string)=>action==='list'?[project,{...project,id:'p2',title:'Projeto encerrado',status:'completed'}]:action==='context'?{text:'Contexto com fonte',nextStep:'Revisar escopo',acceptedDecisions:[project.decisions[0]]}:project)
 ;(window as any).sb={continuity:api}
 await mount(<Projects onOpenSource={open} onResume={resume} />)
 expect(document.body.textContent).not.toContain('Projeto encerrado')
 await select('all'); expect(document.body.textContent).toContain('Projeto encerrado')
 await click([...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Proposta Aurora'))!)
 expect(document.body.textContent).toContain('Última decisão aceita: Escopo aprovado')
 expect(document.body.textContent).toContain('1 proposta(s) aguardando revisão')
 await click(button('reuniao')); expect(open).toHaveBeenCalledWith('notes/reuniao.md')
 await click(button('Retomar contexto')); expect(document.activeElement?.textContent).toBe('Contexto para retomar')
 await click(button('Usar na conversa')); expect(resume).toHaveBeenCalledWith('Contexto com fonte')
})
it('offers the latest active projects and navigates to the chosen project', async () => {
 const nav=vi.fn(); (window as any).sb={continuity:async()=>[project,{...project,id:'p2',title:'Mais recente',updatedAt:'2026-11-14'},{...project,id:'done',status:'completed'}],automationPending:async()=>[],brainFacts:async()=>[],brainPolicy:async()=>({proposals:[]}),brainLedger:async()=>[],brainHealth:async()=>({}),brainListSleep:async()=>[],brainEval:async()=>null}
 await mount(<Today onNavigate={nav} />)
 const cards=[...document.querySelectorAll('.resume-card')]; expect(cards).toHaveLength(2); expect(cards[0].textContent).toContain('Mais recente')
 await click(cards[0].querySelector('button')!); expect(nav).toHaveBeenCalledWith('projects',{projectId:'p2'})
})
it('shows readable source titles while retaining the full path and original content', async () => {
 ;(window as any).sb={brainListMemory:async()=>[{path:'notes/reuniao.md',content:'# Decisão da reunião\nTexto original'}],brainMemoryFile:async()=> '# Decisão da reunião\nTexto original'}
 await mount(<Memory />)
 await click(document.querySelector('.memory-result') as HTMLElement)
 expect(document.activeElement?.getAttribute('aria-label')).toBe('Fonte completa')
 expect(document.querySelector('.memory-source h2')?.textContent).toBe('Decisão da reunião')
 expect(document.querySelector('.memory-path')?.textContent).toBe('notes/reuniao.md')
 expect(document.querySelector('.source-reading')?.textContent).toContain('Texto original')
})
it('explains text-only retrieval without claiming semantic search or no memory', async () => {
 ;(window as any).sb={brainSearch:async()=>({hits:[],semantic:false,notice:''})}
 await mount(<Memory initialRequest={{id:1,query:'decisão'}} />); await flush(200)
 expect(document.body.textContent).toContain('Busca por palavras. A busca por significado não foi usada.')
 expect(document.body.textContent).toContain('Nenhuma memória encontrada para essa busca.')
})
