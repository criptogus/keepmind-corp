import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
// An explicit portable/test profile survives updater relaunches. Never override HOME.
export function configureProfile(edition: 'personal' | 'corp' = 'personal') {
  // Pin existing storage identities independently of presentation/product names.
  const profile = process.env.KEEPMIND_USER_DATA_DIR || app.commandLine.getSwitchValue('user-data-dir') || join(app.getPath('appData'), edition === 'corp' ? 'keepmind-corp' : 'keepmind')
  if (!isAbsolute(profile)) throw new Error('KEEPMIND_USER_DATA_DIR must be absolute')
  mkdirSync(profile, { recursive: true })
  app.setPath('userData', profile)
}
