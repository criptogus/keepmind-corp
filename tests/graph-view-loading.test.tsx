// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('3d-force-graph', () => ({ default: () => {
  const graph: any = new Proxy(() => graph, { get: (_t, key) => key === 'scene' ? () => ({ add() {} }) : key === 'cameraPosition' ? () => ({ x:0,y:0,z:100 }) : () => graph })
  return graph
} }))
import GraphView from '../src/renderer/src/components/GraphView'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
it('shows the loaded map without waiting for the optional activity journal', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} } as any)
  ;(window as any).sb = { brainGraph: async () => ({ nodes: [], links: [], totalFiles:0 }), brainActivity: () => new Promise(() => {}), onActivityPush: () => () => {} }
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<GraphView />); await new Promise(r => setTimeout(r,0)) })
    expect(container.textContent).not.toContain('Waking up the map')
    expect(container.textContent).toContain('0 neurônios')
  } finally { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() }
})
