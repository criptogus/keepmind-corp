import { app, BrowserWindow, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createWriteStream, openSync, closeSync, existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, renameSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { waitForHelperStart } from './update-helper'
import { updateIdentity, selectUpdate, validateUpdateAsset, macSwapScript, shellQuote, shellReceipt, type Edition } from './update-policy'

const execFileP = promisify(execFile)

// Two update channels:
//  1. electron-updater → GitHub "latest" release (tagged v* builds).
//     Requires a signed app on macOS to auto-install.
//  2. "continuous" channel → rolling prerelease rebuilt on every push to
//     main. Custom downloader + self-swap installer that works unsigned.

let edition: Edition = 'personal'
let onDownloaded: ((version: string) => void) | undefined
const CONTINUOUS_TAG = 'continuous'

interface ContinuousUpdate {
  version: string
  url: string
  name: string
  marker: string
  sha256: string
  size: number
}

type Pending = ContinuousUpdate & { file: string }
let pendingContinuous: Pending | null = null
const pendingFile = () => join(app.getPath('userData'), 'update', 'pending.json')
const receipt = () => ({ stateFile: stateFile(), pendingFile: pendingFile(), marker: pendingContinuous!.marker })
// Preserve only process-isolation switches, never arbitrary caller arguments.
const relaunchArgs = () => process.argv.filter(a => ['--no-sandbox', '--disable-gpu'].includes(a) || /^--remote-debugging-port=\d+$/.test(a))
let checking = false

// The continuous release keeps the same semver between version bumps, so we
// track "already seen" by release timestamp + asset digest instead.
function stateFile(): string {
  return join(app.getPath('userData'), 'continuous-state.json')
}
function seenMarker(): string | null {
  try { return JSON.parse(readFileSync(stateFile(), 'utf8')).seen ?? null } catch { return null }
}
function markSeen(marker: string) {
  try { writeFileSync(stateFile(), JSON.stringify({ seen: marker })) } catch {}
}

function send(channel: string, payload?: any) {
  if (channel === 'error') console.error('[updater]', payload?.message ?? 'Update failed')
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:event', { channel, ...payload })
  }
}

// ── electron-updater (signed releases) ──

export function initUpdater(options: { edition?: Edition; onDownloaded?: (version: string) => void } = {}) {
  edition = options.edition ?? 'personal'
  onDownloaded = options.onDownloaded
  if (!app.isPackaged) return { packaged: false }

  autoUpdater.autoDownload = false // we drive downloads ourselves below
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => send('checking'))
  autoUpdater.on('update-available', (info) => send('available', { version: info.version }))
  autoUpdater.on('update-not-available', () => send('up-to-date'))
  autoUpdater.on('update-downloaded', (info) => send('downloaded', { version: info.version }))
  autoUpdater.on('error', (err) => send('error', { message: String(err?.message ?? err) }))

  const tick = () => { void checkForUpdates() }
  setTimeout(tick, 15_000)
  setInterval(tick, 6 * 60 * 60 * 1000)

  return { packaged: true }
}

export function updaterStatus() {
  return { version: app.getVersion(), packaged: app.isPackaged }
}

// ── continuous channel ──
async function findContinuousUpdate(): Promise<ContinuousUpdate | null> {
  const identity = updateIdentity(edition)
  const res = await net.fetch(`https://api.github.com/repos/${identity.repo}/releases/tags/${CONTINUOUS_TAG}`, {
    headers: { 'User-Agent': 'KeepMind-updater', Accept: 'application/vnd.github+json' }
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`github api ${res.status}`)
  const rel = await res.json() as any
  const asset = selectUpdate(rel.assets ?? [], edition, process.platform, process.arch, app.getVersion())
  if (!asset) return null
  const integrity = validateUpdateAsset(asset, edition)
  const version = asset.name.match(/(\d+\.\d+\.\d+)/)![1]
  const marker = `${rel.updated_at ?? rel.created_at}:${asset.digest}`
  if (version === app.getVersion() && !existsSync(stateFile())) { markSeen(marker); return null }
  if (marker === seenMarker()) return null
  return { version, name: asset.name, marker, ...integrity }
}

async function verifyFile(file: string, expected: { sha256: string; size: number }) {
  const { createReadStream } = await import('node:fs')
  const hash = createHash('sha256'); let size = 0
  for await (const chunk of createReadStream(file)) { hash.update(chunk); size += chunk.length }
  if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new Error('Update integrity check failed')
}

async function downloadToFile(update: ContinuousUpdate, dest: string): Promise<void> {
  const res = await net.fetch(update.url, { headers: { 'User-Agent': 'KeepMind-updater' } })
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
  mkdirSync(dirname(dest), { recursive: true })
  const partial = dest + '.partial'
  try {
    let transferred = 0, lastPercent = -1
    await pipeline(Readable.fromWeb(res.body as any), async function* (source) {
      for await (const chunk of source) {
        transferred += chunk.length
        if (transferred > update.size) throw new Error('Update integrity check failed: unexpected size')
        const percent = Math.round(transferred / update.size * 100)
        if (percent !== lastPercent) { lastPercent = percent; send('progress', { percent, transferred, total: update.size }) }
        yield chunk
      }
    }, createWriteStream(partial))
    await verifyFile(partial, update)
    renameSync(partial, dest)
  } catch (error) { rmSync(partial, { force: true }); throw error }
}

// ── self-install ──

function appBundlePath(): string {
  // <App>.app/Contents/MacOS/<bin> → <App>.app
  return join(dirname(dirname(dirname(process.execPath))))
}

// macOS: unzip → swap .app via detached helper script → relaunch.
// Works unsigned because we replace the bundle ourselves.
async function installMac(updateFile: string, version: string): Promise<void> {
  const work = join(app.getPath('userData'), 'update')
  const dest = mkdtempSync(join(work, 'extracted-'))
  await execFileP('ditto', ['-x', '-k', updateFile, dest])
  const name = updateIdentity(edition).appName
  const newApp = join(dest, name + '.app')
  const executableName = name
  if (!existsSync(join(newApp, 'Contents', 'MacOS', executableName))) throw new Error('Expected edition not found in update archive')
  const target = appBundlePath()
  // Stage on the installation volume before touching the working app.
  const staged = target + '.staged'
  rmSync(staged, { recursive: true, force: true })
  await execFileP('ditto', [newApp, staged])
  rmSync(target + '.previous', { recursive: true, force: true })
  const script = join(work, 'swap.sh')
  writeFileSync(script, macSwapScript(target, staged, join(target,'Contents','MacOS',executableName), app.getPath('userData'), process.pid, receipt(), relaunchArgs()))
  chmodSync(script, 0o700)
  const child = spawn('nohup', ['bash', script], { detached: true, stdio: 'ignore' })
  await new Promise<void>((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject) })
  child.unref()
  app.quit()
}

// Windows: the helper waits for app exit, runs NSIS, then relaunches the same profile.
async function installWin(updateFile: string): Promise<void> {
  const q = (v: string) => "'" + v.replace(/'/g, "''") + "'"
  const script = join(app.getPath('userData'), 'update', 'install.ps1')
  const r = receipt()
  const ready = join(app.getPath('userData'), 'update', 'helper.ready')
  rmSync(ready, { force: true })
  writeFileSync(script, [
    "$ErrorActionPreference = 'Stop'",
    `Start-Transcript -Path ${q(join(app.getPath('userData'), 'update', 'install.log'))} -Append`,
    `[System.IO.File]::WriteAllText(${q(ready)}, 'ready')`,
    `Write-Output 'Waiting for application exit'`,
    `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue`,
    `Write-Output 'Starting installer'`,
    `$env:KEEPMIND_USER_DATA_DIR = ${q(app.getPath('userData'))}`,
    `$installer = Start-Process -FilePath ${q(updateFile)} -ArgumentList @('/S', ${q('/D=' + dirname(process.execPath))}) -Wait -PassThru`,
    'Write-Output ("Installer exit: " + $installer.ExitCode)',
    "if ($installer.ExitCode -ne 0) { exit $installer.ExitCode }",
    `[System.IO.File]::WriteAllText(${q(r.stateFile)}, ${q(JSON.stringify({seen:r.marker}))})`,
    `Remove-Item -LiteralPath ${q(r.pendingFile)} -Force`,
    `Start-Process -FilePath ${q(process.execPath)} -ArgumentList ${q(['"--user-data-dir=' + app.getPath('userData') + '"', ...relaunchArgs()].join(' '))}`
  ].join('\r\n'))
  const helperLog = openSync(join(app.getPath('userData'), 'update', 'helper.log'), 'a', 0o600)
  let child: ReturnType<typeof spawn>
  try {
    // DETACHED_PROCESS leaves Windows PowerShell without a console: it exits 0
    // without running the script. A hidden cmd console lets PowerShell start;
    // its grandchild also escapes libuv's kill-on-parent-exit job object.
    const command = 'start "" /b /wait powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%KEEPMIND_UPDATE_SCRIPT%"'
    child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      windowsHide: true, windowsVerbatimArguments: true,
      stdio: ['ignore', helperLog, helperLog],
      env: { ...process.env, KEEPMIND_UPDATE_SCRIPT: script }
    })
  } finally { closeSync(helperLog) }
  await waitForHelperStart(child, ready)
  child.unref(); app.quit()
}

// Linux: AppImage is a single file — swap it like the macOS bundle.
async function installLinux(updateFile: string): Promise<void> {
  const target = process.env.APPIMAGE
  if (!target) throw new Error('Automatic Linux updates require an AppImage installation')
  const script = join(app.getPath('userData'), 'update', 'swap.sh')
  const q = shellQuote
  writeFileSync(script, [
    '#!/bin/bash', 'set -eu',
    `cp ${q(updateFile)} ${q(target + '.staged')}`,
    `chmod +x ${q(target + '.staged')}`,
    `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
    `cp ${q(target)} ${q(target + '.previous')}`,
    `mv ${q(target + '.staged')} ${q(target)}`,
    shellReceipt(receipt()),
    `nohup ${q(target)} ${q('--user-data-dir=' + app.getPath('userData'))} ${relaunchArgs().map(q).join(' ')} >/dev/null 2>&1 &`, ''
  ].join('\n'))
  chmodSync(script, 0o700)
  const child = spawn('nohup', ['bash', script], { detached: true, stdio: 'ignore' })
  await new Promise<void>((resolve,reject) => {child.once('spawn',resolve);child.once('error',reject)})
  child.unref(); app.quit()
}

async function applyPending(): Promise<void> {
  if (!pendingContinuous) return
  const { file, version } = pendingContinuous
  send('installing', { version })
  try {
    await verifyFile(file, pendingContinuous)
    if (process.platform === 'darwin') await installMac(file, version)
    else if (process.platform === 'win32') await installWin(file)
    else await installLinux(file)
  } catch (e: any) {
    send('error', { message: `install failed: ${e?.message ?? e}` })
    pendingContinuous = null
  }
}

// ── public API ──

export async function checkForUpdates(): Promise<any> {
  if (!app.isPackaged) return { packaged: false }

  // continuous channel first (works unsigned; covers every main push)
  if (!checking) {
    checking = true
    try {
      send('checking')
      if (!pendingContinuous && existsSync(pendingFile())) {
        const saved = JSON.parse(readFileSync(pendingFile(), 'utf8')) as Pending
        validateUpdateAsset({name:saved.name,size:saved.size,digest:'sha256:'+saved.sha256,browser_download_url:saved.url},edition)
        if (saved.file !== join(app.getPath('userData'), 'update', saved.name)) throw new Error('Invalid pending update path')
        await verifyFile(saved.file, saved)
        pendingContinuous = saved
      }
      if (pendingContinuous) {
        send('downloaded', { version: pendingContinuous.version, channel: 'continuous' })
        onDownloaded?.(pendingContinuous.version)
        return { packaged: true, continuous: pendingContinuous.version }
      }
      const upd = await findContinuousUpdate()
      if (upd) {
        send('available', { version: upd.version, channel: 'continuous' })
        const dest = join(app.getPath('userData'), 'update', upd.name)
        await downloadToFile(upd, dest)
        pendingContinuous = { ...upd, file: dest }
        writeFileSync(pendingFile(), JSON.stringify(pendingContinuous), { mode: 0o600 })
        send('downloaded', { version: upd.version, channel: 'continuous' })
        onDownloaded?.(upd.version)
        return { packaged: true, continuous: upd.version }
      }
      send('up-to-date')
      // electron-updater stays dormant: it needs a signed app + a "latest"
      // release on macOS, and errors noisily without one. The continuous
      // channel above is the update path until we ship signed builds.
      return { packaged: true, continuous: null }
    } catch (e: any) {
      send('error', { message: String(e?.message ?? e) })
      return { packaged: true, error: String(e?.message ?? e) }
    } finally {
      checking = false
    }
  }
  return { packaged: true, busy: true }
}

export function installUpdate() {
  if (!app.isPackaged) return false
  if (pendingContinuous) { void applyPending(); return true }
  try { autoUpdater.quitAndInstall(); return true } catch { return false }
}
