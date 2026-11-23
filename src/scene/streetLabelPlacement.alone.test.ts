import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createLabelBlockers } from '../lib/labelBlockers'
import { RECT } from '../lib/labelGeometry'
import { crowdedStation, snapshot, topDownCamera, type PlacedSnapshot } from './labelFixture'
import { createLabelPlacement } from './labelPlacementLayout'
import { newView } from './labelPlacementState'

// The placement module reads the TEMPORARY look flags from window.location on import; tests run in node.
vi.stubGlobal('window', { location: { search: '' } })
const { placeLabels } = await import('./streetLabelPlacement')
vi.unstubAllGlobals()

/** One crowded station placed alone, as the focused station is today: first frame, then after a 5 px pan. */
function placeAlone(): { first: PlacedSnapshot; panned: PlacedSnapshot } {
  const s = crowdedStation()
  const stations = [
    { x: s.anchor.x + 50, z: s.anchor.z + 40 },
    { x: 400, z: 0 },
  ]
  const p = createLabelPlacement([{ layer: s.layer, bundles: s.bundles }], stations)
  s.w.forEach((w, i) => (p.w[i] = w))
  s.h.forEach((h, i) => (p.h[i] = h))
  const levels = createLabelBlockers()
  levels.rects.set([300, 300, 360, 320], 0 * RECT)
  levels.counts[0] = 1
  const a = new Vector3()
  const b = new Vector3()
  const place = (x: number): PlacedSnapshot => {
    const view = newView(topDownCamera(x), 1.25)
    view.width = 800
    view.height = 800
    view.insetTop = 40
    view.insetBottom = 24
    view.panel = { left: 620, top: 60, right: 790, bottom: 600 }
    view.radiusM = 250
    view.markerRadiusM = 3
    view.ringRadiusM = 6
    view.focusRing = s.anchor
    view.priorityEntrance = 5
    view.focusedFirst = true
    placeLabels(p, view, levels, a, b)
    return snapshot(p.out, p.cand.start, p.cx, p.cy, p.cand.count)
  }
  // 2 m at about 2.54 px a meter.
  return { first: place(0), panned: place(2) }
}

describe('placeLabels, one station alone (characterization)', () => {
  it('places the crowded station as it did before the shared pass', () => {
    const { first, panned } = placeAlone()
    expect(first).toEqual(FIRST)
    expect(panned).toEqual(PANNED)
  })
})

const FIRST: PlacedSnapshot = {
  out: [-1, 0, 0, 2, -1, 1, 1, 2, 0, 6, 0, 0, 6],
  centres: [
    null,
    [439.02, 311.2],
    [413.8, 331.49],
    [436.9, 288.87],
    null,
    [452.54, 450.75],
    [455.32, 471.04],
    [565.77, 451.26],
    [70.15, 257.6],
    [434.37, 158.96],
    [280.34, 178.93],
    [120.9, 523.18],
    [264.14, 285.82],
  ],
}
const PANNED: PlacedSnapshot = {
  out: [-1, 0, 0, 2, -1, 1, 1, 2, 0, 6, 1, 0, 6],
  centres: [
    null,
    [433.95, 311.2],
    [408.72, 331.49],
    [431.83, 288.87],
    null,
    [447.47, 450.75],
    [450.24, 471.04],
    [560.69, 451.26],
    [65.08, 257.6],
    [429.3, 158.96],
    [275.26, 178.93],
    [115.83, 523.18],
    [259.06, 285.82],
  ],
}
