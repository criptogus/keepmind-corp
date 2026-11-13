import { useEffect, useRef, useState } from 'react'
import { renderAvatarSvg, type AvatarDefinition } from 'open-bot-avatar'
import { mountAvatar, type MountedAvatar } from 'open-bot-avatar/dom'
import { useAppearance } from '../lib/appearance'
import './KeepMindAvatar.css'

export type KeepMindAvatarState = 'idle' | 'thinking' | 'happy' | 'error' | 'review'
const definition: AvatarDefinition = {
  version: 1, id: 'keepmind', name: 'KeepMind',
  body: { path: 'M50 12 C71 12 84 27 84 48 C84 69 70 84 50 88 C30 84 16 69 16 48 C16 27 29 12 50 12 Z' },
  eyes: { x: 50, y: 47, spacing: 18, scale: 0.85 }
}
const fallback = renderAvatarSvg(definition, { color: '#54c7d9', eyeColor: '#102b3d', reducedMotion: true })

export default function KeepMindAvatar({ state = 'idle', label = '', size = 48, active = true }: {
  state?: KeepMindAvatarState; label?: string; size?: number; active?: boolean
}) {
  const { avatarEnabled, reducedMotion } = useAppearance()
  const host = useRef<HTMLDivElement>(null)
  const mounted = useRef<MountedAvatar | null>(null)
  const [failed, setFailed] = useState(false)
  const mood = state === 'thinking' ? 'thinking' : state === 'happy' ? 'happy' : 'idle'
  useEffect(() => {
    if (!avatarEnabled || !host.current) return
    let check: ReturnType<typeof setTimeout> | undefined
    try {
      mounted.current = mountAvatar(host.current, { definition, color: '#54c7d9', eyeColor: '#102b3d', followPointer: false, still: reducedMotion || !active, reducedMotion, mood, label: '' })
      setFailed(false)
      check = setTimeout(() => { if (host.current && !host.current.firstChild) setFailed(true) }, 500)
    } catch { setFailed(true) }
    return () => { if (check) clearTimeout(check); mounted.current?.destroy(); mounted.current = null }
  }, [avatarEnabled, reducedMotion, active])
  useEffect(() => { mounted.current?.update({ mood, reducedMotion, still: reducedMotion || !active, label: '' }) }, [mood, reducedMotion, active])
  if (!avatarEnabled) return null
  return <div className="keepmind-avatar" style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
    <div ref={host} className="keepmind-avatar__host" />
    {failed && <div className="keepmind-avatar__fallback" dangerouslySetInnerHTML={{ __html: fallback }} />}
  </div>
}
