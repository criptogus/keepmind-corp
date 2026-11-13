import { useEffect, useState } from 'react'

export interface AppearancePreferences {
  avatarEnabled: boolean
  motionEnabled: boolean
  backgroundEnabled: boolean
}
const KEY = 'keepmind:appearance'
const EVENT = 'keepmind:appearance-change'
const defaults: AppearancePreferences = { avatarEnabled: true, motionEnabled: true, backgroundEnabled: false }

export function readAppearance(): AppearancePreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      avatarEnabled: typeof saved.avatarEnabled === 'boolean' ? saved.avatarEnabled : defaults.avatarEnabled,
      motionEnabled: typeof saved.motionEnabled === 'boolean' ? saved.motionEnabled : defaults.motionEnabled,
      backgroundEnabled: typeof saved.backgroundEnabled === 'boolean' ? saved.backgroundEnabled : defaults.backgroundEnabled
    }
  } catch { return { ...defaults } }
}
export function updateAppearance(patch: Partial<AppearancePreferences>) {
  const next = { ...readAppearance(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage may be unavailable */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }))
}
export function useAppearance() {
  const [preferences, setPreferences] = useState(readAppearance)
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  useEffect(() => {
    const onChange = (event: Event) => setPreferences((event as CustomEvent<AppearancePreferences>).detail || readAppearance())
    const onStorage = (event: StorageEvent) => { if (event.key === KEY) setPreferences(readAppearance()) }
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onMotion = () => setSystemReduced(media?.matches ?? false)
    window.addEventListener(EVENT, onChange)
    window.addEventListener('storage', onStorage)
    media?.addEventListener('change', onMotion)
    return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener('storage', onStorage); media?.removeEventListener('change', onMotion) }
  }, [])
  const reducedMotion = systemReduced || !preferences.motionEnabled
  useEffect(() => { document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full' }, [reducedMotion])
  return { ...preferences, reducedMotion, updateAppearance }
}
