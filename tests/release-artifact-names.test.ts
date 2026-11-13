import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
require('app-builder-lib') // Initialize its public entrypoint before internal helpers.
const { load } = require('js-yaml')
const { expandMacro } = require('app-builder-lib/out/util/macroExpander')
const { computeSafeArtifactNameIfNeeded } = require('app-builder-lib/out/platformPackager')
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget')
const defaultPattern = Object.getOwnPropertyDescriptor(NsisTarget.prototype, 'installerFilenamePattern')!.get!.call({ isPortable: false })
const expand = (pattern: string, productName: string) => expandMacro(pattern, 'x64', { productName, version: '0.2.6' }, { ext: 'exe' }, false)

describe('Windows installer names used by external GitHub publication', () => {
  it('reproduces the default NSIS filename/manifest mismatch', () => {
    const filename = expand(defaultPattern, 'KeepMind')
    expect(filename).toBe('KeepMind Setup 0.2.6.exe')
    expect(computeSafeArtifactNameIfNeeded(filename, () => '')).toBe('KeepMind-Setup-0.2.6.exe')
  })
  it.each(['electron-builder.yml', 'electron-builder.corp.yml'])('%s produces the same on-disk and update-manifest filename', file => {
    const config = load(readFileSync(file, 'utf8'))
    const filename = expand(config.nsis?.artifactName ?? defaultPattern, config.productName)
    expect(filename).toMatch(/^[A-Za-z0-9._-]+\.exe$/)
    expect(computeSafeArtifactNameIfNeeded(filename, () => '')).toBeNull()
  })
})
