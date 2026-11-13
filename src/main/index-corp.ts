import { initUpdater, checkForUpdates, installUpdate } from './services/updater'
import { configureProfile } from './services/profile'
// KeepMind Corp desktop — embeds the corporate second-brain server and opens the web UI.
import { app, BrowserWindow, shell, Menu, dialog } from 'electron'
import { join } from 'node:path'
import { startEmbeddedCorpServer, type CorpServerHandle } from './services/corp-server'

configureProfile('corp')

let mainWindow: BrowserWindow | null = null
let corp: CorpServerHandle | null = null

const log = (m: string) => console.log(`[keepmind-corp] ${m}`)

function openExternalSafe(url: string) {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'mailto:') shell.openExternal(url)
  } catch { /* ignore */ }
}

function createWindow(baseUrl: string) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#030712',
    title: 'KeepMind Corp',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })

  void mainWindow.loadURL(`${baseUrl}/`)
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  app.setName('KeepMind Corp')
  if (process.platform === 'win32') app.setAppUserModelId('com.keepmind.corp')
  try {
    corp = await startEmbeddedCorpServer(log)
    createWindow(corp.baseUrl)
    let updatePromptOpen = false
    initUpdater({ edition: 'corp', onDownloaded: async version => {
      if (updatePromptOpen) return
      updatePromptOpen = true
      try {
        const choice = await dialog.showMessageBox({ type: 'info', message: `KeepMind Corp ${version} pronto para instalar`, detail: 'Seus dados serão preservados. Reiniciar agora?', buttons: ['Depois', 'Reiniciar e atualizar'], defaultId: 0, cancelId: 0 })
        if (choice.response === 1) installUpdate()
      } finally { updatePromptOpen = false }
    } })
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { label: 'Atualizações', submenu: [{ label: 'Verificar atualizações', click: async () => {
        const result = await checkForUpdates()
        if (!result.continuous) await dialog.showMessageBox({ message: result.error || 'Nenhuma atualização disponível.', type: result.error ? 'error' : 'info' })
      } }] }
    ]))
  } catch (e) {
    log(`startup failed: ${e}`)
    app.quit()
  }
})

app.on('before-quit', () => {
  corp?.stop()
  corp = null
})

app.on('window-all-closed', () => {
  corp?.stop()
  app.quit()
})

app.on('activate', () => {
  if (mainWindow === null && corp) createWindow(corp.baseUrl)
})
