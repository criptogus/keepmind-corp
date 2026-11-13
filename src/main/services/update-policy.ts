export type Edition = 'personal' | 'corp'
export const updateIdentity = (edition: Edition) => edition === 'corp'
  ? { repo: 'criptogus/keepmind-corp', appName: 'KeepMind Corp', prefix: 'KeepMind-Corp' }
  : { repo: 'criptogus/keepmind', appName: 'KeepMind', prefix: 'KeepMind(?:-SB)?' }
export type ReleaseAsset = { name: string; updated_at?: string; digest?: string; id?: number; size?: number; browser_download_url?: string }
const version = (v: string) => (v.match(/\d+/g) ?? []).slice(0, 3).map(Number)
export function compareVersions(a: string, b: string): number {
  const x = version(a), y = version(b)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}
export function selectUpdate(assets: ReleaseAsset[], edition: Edition, platform: string, arch: string, installed: string) {
  const prefix = updateIdentity(edition).prefix
  const suffix = platform === 'darwin' ? `(?:universal|${arch})-mac\\.zip` : platform === 'win32' ? 'exe' : 'AppImage'
  const pattern = platform === 'win32' ? new RegExp(`^${prefix}(?:-Setup-|\\.Setup\\.)(\\d+\\.\\d+\\.\\d+)\\.exe$`) : new RegExp(`^${prefix}-(\\d+\\.\\d+\\.\\d+)(?:-${suffix}|\\.${suffix})$`)
  return assets.filter(a => pattern.test(a.name) && compareVersions(a.name, installed) >= 0).sort((a,b) => compareVersions(b.name,a.name) || String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))[0]
}
export function validateUpdateAsset(asset: ReleaseAsset, edition: Edition) {
  const repo = updateIdentity(edition).repo
  const url = new URL(asset.browser_download_url ?? '')
  if (url.origin !== 'https://github.com' || url.username || url.password || !url.pathname.startsWith(`/${repo}/releases/download/continuous/`) || decodeURIComponent(url.pathname.split('/').pop()!) !== asset.name || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') || !Number.isSafeInteger(asset.size) || asset.size! <= 0) throw new Error('Invalid update asset or missing integrity metadata')
  return { url: url.href, sha256: asset.digest!.slice(7), size: asset.size! }
}
export const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
export type UpdateReceipt = { stateFile: string; pendingFile: string; marker: string }
export const shellReceipt = (r: UpdateReceipt) => `printf '%s' ${shellQuote(JSON.stringify({ seen: r.marker }))} > ${shellQuote(r.stateFile)}\nrm -f ${shellQuote(r.pendingFile)}`
export function macSwapScript(target: string, staged: string, executable: string, profile: string, parentPid: number, receipt?: UpdateReceipt, relaunchArgs: string[] = []) {
  const q = shellQuote
  return ['#!/bin/bash', 'set -eu', `while kill -0 ${parentPid} 2>/dev/null; do sleep 0.2; done`,
    `target=${q(target)}`, `staged=${q(staged)}`, `backup=${q(target + '.previous')}`,
    'test -d "$target" && test -d "$staged"', 'test ! -e "$backup"',
    'mv "$target" "$backup"',
    'if ! mv "$staged" "$target"; then mv "$backup" "$target"; exit 1; fi',
    ...(receipt ? [shellReceipt(receipt)] : []),
    `nohup ${q(executable)} ${q('--user-data-dir=' + profile)} ${relaunchArgs.map(q).join(' ')} >/dev/null 2>&1 &`,
    // Keep the prior bundle for recovery; cleanup happens before the next staged update.
    ''].join('\n')
}
