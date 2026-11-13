// Development-only synthetic data. No credentials, network providers or user memory.
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/renderer/src/App'
import { installBrowserShim } from '../../src/renderer/src/browserShim'
import { updateAppearance } from '../../src/renderer/src/lib/appearance'
import '../../src/renderer/src/styles.css'
import '../../src/renderer/src/experience.css'
installBrowserShim()
const params = new URLSearchParams(location.search)
updateAppearance({ motionEnabled: params.get('motion') !== 'reduced' })
const source = '# Reunião de escopo — Aurora\n\nRegistro fictício para validar a interface.\n\nA equipe aprovou entregar o diagnóstico antes de ampliar o escopo.\n\n## Próximo passo\nRevisar a proposta com a equipe.\n\n## Proposta pendente\nIncluir treinamento ainda depende de aprovação.'
const project = { id:'aurora', title:'Proposta Aurora', objective:'Preparar uma proposta com escopo e prazo claros.',nextStep:'Revisar a proposta com a equipe.',status:'active',revision:1,updatedAt:'2026-11-13T15:00:00Z',successCriteria:'Escopo revisado e aprovado',decisions:[{id:'d1',choice:'Começar pelo diagnóstico',status:'accepted',createdAt:'2026-11-12',evidence:[{path:'notes/reuniao-aurora.md'}]},{id:'d2',choice:'Incluir treinamento',status:'proposed',createdAt:'2026-11-13'}],outcomes:[{observedResult:'Diagnóstico preparado para revisão',createdAt:'2026-11-13'}],questions:[{question:'Qual é o prazo de aprovação?',status:'open',priority:'high'}],attempts:[],artifacts:[],evidence:[{path:'notes/reuniao-aurora.md'}],analysisReports:[] }
let attempts=0
const wait = () => new Promise(r=>setTimeout(r,350))
Object.assign(window.sb,{
 memorySecurityStatus:async()=>({space:'personal',configured:true,unlocked:true}),
 continuity:async(action:string)=>{await wait();if(params.has('error') && attempts++===0)throw Error('Falha sintética de carregamento');if(action==='list')return [project,{...project,id:'atlas',title:'Plano Atlas',updatedAt:'2026-11-12',nextStep:'Conferir as decisões da última reunião.'}];if(action==='get')return project;if(action==='context')return {text:'Projeto Aurora\nDecisão aceita: começar pelo diagnóstico.\nPróximo passo: revisar a proposta.\nFonte: notes/reuniao-aurora.md',objective:project.objective,nextStep:project.nextStep,acceptedDecisions:[project.decisions[0]],openQuestions:project.questions};if(action==='check')return {evidence:[{kind:'project',path:'notes/reuniao-aurora.md',status:'verified'}],impacts:[]};throw Error('Esta prévia não salva alterações.')},
 brainFacts:async()=>[],brainPolicy:async()=>({active:'',proposals:[]}),brainLedger:async()=>[{ts:'2026-11-13T15:00:00Z',sentence:'Decisão de escopo registrada para retomar a proposta.',path:'notes/reuniao-aurora.md'}],
 brainListMemory:async()=>[{path:'notes/reuniao-aurora.md',content:source}],brainMemoryFile:async()=>source,
 brainSearch:async()=>({hits:[{path:'notes/reuniao-aurora.md',title:'Reunião de escopo — Aurora',snippet:'A equipe aprovou começar pelo diagnóstico.'}],semantic:false,notice:''}),
 brainChat:async()=>{await wait();return {text:'Na demonstração, a decisão aceita foi **começar pelo diagnóstico**. O próximo passo é revisar a proposta com a equipe. Incluir treinamento ainda é uma proposta.',memories:['notes/reuniao-aurora.md'],steps:['Consulta à memória sintética concluída'],saved:[]}},
 brainCapture:async()=>{throw Error('Esta prévia não salva memória.')}
})
createRoot(document.getElementById('root')!).render(<App />)
