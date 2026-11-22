/** The exit path over every committed interior (authored, generated, and complexes with walkways such as Union Sq):
 *  for each platform track's stop, the quickest way out draws, ends at its exit and runs on the drawn connectors. */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../data/stationSchema'
import { quickestExit } from './exitChoice'
import { planEnds } from './interiorConnectors'
import { interiorDecks, strokeBandOf } from './interiorDecks'
import type { Buffers } from './interiorSegments'
import { connectorContext, RAIL_DROP_M } from './interiorGeometry'
import { BOARD_HALF_M, exitPathBuffers, exitPathCenterline } from './interiorPath'

const DIR = 'public/data/stations'
const interiors = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as StationInterior)

const Y = 2
const opts = { yScale: Y, stepRise: 0.18, railDrop: RAIL_DROP_M, entranceSize: 2.5, rgb: [1, 0, 0.5] as const, restroke: true, boardHalfM: BOARD_HALF_M }
const close = (p: readonly number[], q: readonly number[]) => p.every((v, i) => Math.abs(v - q[i]!) < 1e-9)
/** Whether `b` holds a segment from p to q (float32 buffers). */
function holds(b: Buffers, p: readonly number[], q: readonly number[]): boolean {
  const f = b.positions
  const near = (o: number, r: readonly number[]) => r.every((v, i) => Math.abs(f[o + i]! - v) < 1e-3)
  for (let o = 0; o < f.length; o += 6) if (near(o, p) && near(o + 3, q)) return true
  return false
}

describe('the exit path on every committed interior', () => {
  it('draws the quickest way out from every platform track, on the drawn connectors, to the exit', { timeout: 60_000 }, () => {
    expect(interiors.length).toBeGreaterThan(200)
    expect(interiors.some((i) => i.connectors.some((c) => c.kind === 'walkway'))).toBe(true)
    let drawn = 0
    const midBand = new Set<string>()
    for (const interior of interiors) {
      const ctx = connectorContext(interior, { yScale: Y, stepRise: 0.18, colorOf: () => [0, 0, 0] })
      const levelIndex = new Map(interior.levels.map((l, i) => [l.id, i]))
      const stops = new Set(interior.platforms.flatMap((p) => p.tracks.map((t) => t.stopId)))
      for (const stopId of stops) {
        const where = `${interior.stationId} ${stopId}`
        const choice = quickestExit({ interior, stopId })
        if (choice.kind !== 'exit') continue
        const decks = interiorDecks(interior)
        // No connector may throw on crossing several deck roofs: they cut nested, as the interior's do.
        const layers = exitPathBuffers(interior, choice, { ...opts, decks, dashInStation: choice.probable })
        expect(layers.bands.reduce((n, b) => n + b.positions.length, 0), where).toBeGreaterThan(0)
        const points = exitPathCenterline(interior, choice, opts)
        const line = points.map((q) => q.p)
        // Every flat piece draws in the band of its level.
        for (let j = 1; j < points.length; j++) {
          const [a, b] = [points[j - 1]!, points[j]!]
          if (a.level !== b.level || a.p[1] !== b.p[1]) continue
          expect(holds(layers.bands[strokeBandOf(b.level, decks)]!, a.p, b.p), `${where} piece ${j}`).toBe(true)
        }
        if (layers.bands.slice(1, -1).some((b) => b.positions.length > 0)) midBand.add(interior.stationId)
        const last = line.at(-1)!
        expect(last[1], where).toBe(0)
        if (choice.exit.entranceId !== null) expect(close(last, [choice.exit.point[0], 0, choice.exit.point[1]]), where).toBe(true)
        for (const id of choice.connectorIds) {
          const c = interior.connectors.find((k) => k.id === id)!
          const [li, ui] = [levelIndex.get(c.lower.level)!, levelIndex.get(c.upper.level)!]
          const ends = planEnds(ctx, c, li, ui)
          const lower = [ends.lower[0], interior.levels[li]!.y * Y, ends.lower[1]]
          const upper = [ends.upper[0], interior.levels[ui]!.y * Y, ends.upper[1]]
          const k = line.findIndex((p, j) => j > 0 && ((close(line[j - 1]!, lower) && close(p, upper)) || (close(line[j - 1]!, upper) && close(p, lower))))
          expect(k, `${where} ${id}`).toBeGreaterThan(0)
        }
        drawn++
      }
    }
    expect(drawn).toBeGreaterThan(300)
    // Union Sq (635) has three decks: its paths cross the bands between them.
    expect([...midBand]).toContain('635')
  })
})
