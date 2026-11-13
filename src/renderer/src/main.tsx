import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installBrowserShim } from './browserShim'
import { installCorpShim } from './corpShim'
import './styles.css'
import './experience.css'

if (import.meta.env.VITE_KEEPMIND_CORP === '1') installCorpShim()
else installBrowserShim()

// macOS traffic lights overlay the top-left corner — flag it for CSS
if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
  document.documentElement.classList.add('is-mac')
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
