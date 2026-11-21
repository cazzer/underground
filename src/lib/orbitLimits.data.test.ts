import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../data/stationSchema'
import { interiorFocusAnchor } from './interiorFraming'
import { PAN_MARGIN, PAN_RADIUS_MAX, panRadius } from './orbitLimits'

describe('panRadius on real data', () => {
  it("covers every Bedford Av slab vertex and entrance from the plan center, below the cap", () => {
    const interior = JSON.parse(readFileSync('public/data/stations/L08.json', 'utf8')) as StationInterior
    const a = interiorFocusAnchor({ x: 0, z: 0 }, interior, 2, Math.SQRT2)
    const r = panRadius(a.reach)
    expect(r).toBeLessThan(PAN_RADIUS_MAX)
    const points = [...interior.slabs.flatMap((s) => s.outline), ...interior.entrances.map((e) => [e.x, e.z] as const)]
    expect(points.length).toBeGreaterThan(10)
    for (const [x, z] of points) expect(Math.hypot(x - a.center.x, z - a.center.z) + PAN_MARGIN).toBeLessThanOrEqual(r + 1e-9)
  })
})
