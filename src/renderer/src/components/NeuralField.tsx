import { useEffect, useRef } from 'react'
import { useAppearance } from '../lib/appearance'

// Living neural field. Neurons drift, keep a few synapses each, and
// electrical pulses travel those links without ever stopping. A pulse
// that arrives charges the target and often fires the next synapse,
// so the field reads as a brain that is awake.

interface Neuron {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  phase: number
  charge: number
}

interface Spark {
  a: number
  b: number
  t: number
  speed: number
  chained: boolean
}

export default function NeuralField({ activity = 0 }: { activity?: number }) {
  const { backgroundEnabled, reducedMotion } = useAppearance()
  const ref = useRef<HTMLCanvasElement>(null)
  const actRef = useRef(activity)
  actRef.current = activity

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !backgroundEnabled || reducedMotion) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let w = 0
    let h = 0
    let raf = 0
    let last = 0
    let neurons: Neuron[] = []
    let sparks: Spark[] = []
    let neighbors: number[][] = []
    let neighborAt = 0

    const resize = () => {
      const box = canvas.getBoundingClientRect()
      w = box.width >= 64 ? box.width : window.innerWidth
      h = box.height >= 64 ? box.height : window.innerHeight
      // Render below native resolution and let CSS upscale — every mark comes
      // out softly diffused, which is what makes the field read as background
      // bokeh instead of sharp dots.
      const scale = Math.min(devicePixelRatio || 1, 1.5) * 0.55
      canvas.width = Math.max(1, Math.floor(w * scale))
      canvas.height = Math.max(1, Math.floor(h * scale))
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      const count = Math.min(130, Math.max(60, Math.floor((w * h) / 16000)))
      neurons = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: 1.3 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
        charge: Math.random()
      }))
      neighbors = neurons.map(() => [])
      sparks = []
    }

    const rebuildNeighbors = () => {
      const reach = 128
      for (let i = 0; i < neurons.length; i++) {
        const list: { j: number; d: number }[] = []
        const n = neurons[i]
        for (let j = 0; j < neurons.length; j++) {
          if (i === j) continue
          const m = neurons[j]
          const d = Math.hypot(m.x - n.x, m.y - n.y)
          if (d < reach) list.push({ j, d })
        }
        list.sort((a, b) => a.d - b.d)
        neighbors[i] = list.slice(0, 3).map(o => o.j)
      }
    }

    const fire = (from: number, chained: boolean) => {
      const outs = neighbors[from]
      if (!outs?.length) return
      const b = outs[Math.floor(Math.random() * outs.length)]
      if (sparks.some(s => s.a === from && s.b === b)) return
      sparks.push({
        a: from,
        b,
        t: 0,
        speed: (chained ? 0.0034 : 0.0022) + Math.random() * 0.0016,
        chained
      })
    }

    const frame = (now: number) => {
      if (document.hidden) { raf = 0; return }
      raf = requestAnimationFrame(frame)
      const dt = Math.min(now - last, 32)
      last = now
      if (now - neighborAt > 280) {
        rebuildNeighbors()
        neighborAt = now
      }
      const boost = 1 + actRef.current * 1.4
      ctx.clearRect(0, 0, w, h)

      for (const n of neurons) {
        n.x += n.vx * dt * 0.045 * boost
        n.y += n.vy * dt * 0.045 * boost
        if (n.x < -30) n.x = w + 30
        if (n.x > w + 30) n.x = -30
        if (n.y < -30) n.y = h + 30
        if (n.y > h + 30) n.y = -30
        n.charge *= 0.985
      }

      ctx.lineWidth = 1
      for (let i = 0; i < neurons.length; i++) {
        for (const j of neighbors[i] ?? []) {
          if (j < i) continue
          const a = neurons[i]
          const b = neurons[j]
          const hot = Math.max(a.charge, b.charge)
          ctx.strokeStyle = hot > 0.2
            ? `rgba(125,211,252,${(0.10 + hot * 0.30).toFixed(3)})`
            : 'rgba(56,189,248,0.09)'
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.t += s.speed * dt * boost
        const A = neurons[s.a]
        const B = neurons[s.b]
        if (!A || !B || s.t >= 1) {
          if (B) {
            B.charge = 1
            if (Math.random() < (s.chained ? 0.42 : 0.62)) fire(s.b, true)
          }
          sparks.splice(i, 1)
          continue
        }
        const x = A.x + (B.x - A.x) * s.t
        const y = A.y + (B.y - A.y) * s.t
        const trail = Math.max(0, s.t - 0.12)
        const tx = A.x + (B.x - A.x) * trail
        const ty = A.y + (B.y - A.y) * trail
        ctx.strokeStyle = s.chained ? 'rgba(224,242,254,0.55)' : 'rgba(103,232,249,0.5)'
        ctx.lineWidth = s.chained ? 1.6 : 1.15
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(x, y)
        ctx.stroke()
        ctx.fillStyle = '#f0fbff'
        ctx.beginPath()
        ctx.arc(x, y, s.chained ? 2.3 : 1.8, 0, Math.PI * 2)
        ctx.fill()
      }

      // Neuron bodies stay dim and steady — brightness only swells when a
      // charge arrives (a real spike), instead of every cell blinking on a
      // sine wave like Christmas lights.
      for (const n of neurons) {
        const breathe = 0.5 + 0.08 * Math.sin(now * 0.0012 + n.phase)
        const glow = Math.min(1, n.charge)
        if (glow > 0.12) {
          ctx.fillStyle = `rgba(125,211,252,${(glow * 0.20).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r * (2 + glow * 2.4), 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = glow > 0.45 ? '#dbeafe' : `rgba(147,197,253,${(0.30 + breathe * 0.18 + glow * 0.35).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r * (0.85 + glow * 0.9), 0, Math.PI * 2)
        ctx.fill()
      }

      const minSparks = 7 + Math.round(actRef.current * 6)
      let guard = 0
      while (sparks.length < minSparks && neurons.length > 4 && guard < 24) {
        fire(Math.floor(Math.random() * neurons.length), false)
        guard++
      }
    }

    resize()
    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    const observer = new ResizeObserver(onResize)
    observer.observe(canvas)
    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0 }
      else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame) }
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (!document.hidden) raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      observer.disconnect()
    }
  }, [backgroundEnabled, reducedMotion])

  return backgroundEnabled && !reducedMotion ? <canvas ref={ref} className="neural-field" aria-hidden="true" /> : null
}
