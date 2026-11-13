// Development fixture only. No account, credentials, provider or external request.
import React from 'react'
import { createRoot } from 'react-dom/client'
import Wizard from '../../src/renderer/src/components/Wizard'
import { updateAppearance } from '../../src/renderer/src/lib/appearance'
import '../../src/renderer/src/styles.css'
import '../../src/renderer/src/experience.css'

const query = new URLSearchParams(location.search)
updateAppearance({ motionEnabled: query.get('motion') !== 'reduced' })
document.documentElement.classList.add('is-mac')
let attempt = 0
window.sb = {
  memorySecurityStatus: async () => ({ configured: true, unlocked: true }),
  localLlmStatus: async () => ({config:{modelId:'qwen2.5-3b'},catalog:[{id:'qwen2.5-3b',label:'Qwen 2.5 · 3B',sizeGB:2},{id:'qwen2.5-7b',label:'Qwen 2.5 · 7B',sizeGB:4.7}]}),
  aiCodexStatus: async () => ({ loggedIn: true }), onLocalLlmProgress: () => () => {},
  aiProviders: async () => [{ id:'codex',models:['fixture-model'] }],
  aiTest: async () => ({ ok:false,error:'Não foi possível conectar. Confira sua configuração e tente novamente.' }),
  updateAi: async () => {}, updateLocalLlm: async () => {}, localLlmEnsure: async () => {},
  brainCapture: async () => { if(query.has('error') && attempt++ === 0) throw Error('Não foi possível salvar. Tente novamente.'); return 'Ideia guardada.' },
  setConfig: async () => {}
} as any
createRoot(document.getElementById('root')!).render(<Wizard config={{ai:{provider:'codex'}}} onToast={()=>{}} onDone={()=>{document.getElementById('root')!.textContent='Fluxo de teste concluído. Nenhum dado real foi salvo.'}} />)
