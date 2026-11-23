/** The way in drawn as a station path: the exit's pieces over the reversed search, at Bedford Av and on every
 *  committed interior. */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../data/stationSchema'
import { NOT_INTERIOR_FILES } from '../../scripts/lib/stationIndex.ts'
import { quickestEntry, quickestExit, type BoardChoice, type ExitChoice } from './exitChoice'
import { interiorDecks } from './interiorDecks'
import { RAIL_DROP_M } from './interiorGeometry'
import { BOARD_HALF_M, exitPathBuffers, exitPathCenterline, stationPathKey } from './interiorPath'

const DIR = 'public/data/stations'
const load = (id: string) => JSON.parse(readFileSync(`${DIR}/${id}.json`, 'utf8')) as StationInterior
const opts = { yScale: 2, stepRise: 0.18, railDrop: RAIL_DROP_M, entranceSize: 2.5, rgb: [1, 0, 0.5] as const, restroke: true, boardHalfM: BOARD_HALF_M }

const board = (interior: StationInterior, stopId: string): BoardChoice => {
  const r = quickestEntry({ interior, stopId })
  if (r.kind !== 'board') throw new Error(`no way in at ${stopId}: ${r.reason}`)
  return r
}
const exit = (interior: StationInterior, stopId: string): ExitChoice => {
  const r = quickestExit({ interior, stopId })
  if (r.kind !== 'exit') throw new Error(`no way out at ${stopId}: ${r.reason}`)
  return r
}

describe('the way in at Bedford Av', () => {
  const l08 = load('L08')
  const decks = interiorDecks(l08)

  it('draws the same pieces as the way out through the same entrance, its entrance square included', () => {
    for (const stopId of ['L08N', 'L08S']) {
      const into = board(l08, stopId)
      const out = exit(l08, stopId)
      expect(into.exit).toEqual(out.exit)
      expect(into.connectorIds).toEqual(out.connectorIds)
      const a = exitPathBuffers(l08, into, { ...opts, decks, dashInStation: false })
      const b = exitPathBuffers(l08, out, { ...opts, decks, dashInStation: false })
      expect(a.bands.map((x) => Array.from(x.positions))).toEqual(b.bands.map((x) => Array.from(x.positions)))
      expect(Array.from(a.keepOut)).toEqual(Array.from(b.keepOut))
    }
  })

  it('keys the way in apart from the way out', () => {
    expect(stationPathKey(board(l08, 'L08N'))).toBe(`board:L08N<${board(l08, 'L08N').exit.entranceId}`)
    expect(stationPathKey(board(l08, 'L08N'))).not.toBe(stationPathKey(exit(l08, 'L08N')))
  })
})

describe('the way in on every committed interior', () => {
  const interiors = readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && !NOT_INTERIOR_FILES.has(f))
    .map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as StationInterior)

  it('draws from every track with one, ending at the street', { timeout: 60_000 }, () => {
    expect(interiors.length).toBeGreaterThan(200)
    let drawn = 0
    for (const interior of interiors) {
      for (const stopId of new Set(interior.platforms.flatMap((p) => p.tracks.map((t) => t.stopId)))) {
        const r = quickestEntry({ interior, stopId })
        if (r.kind !== 'board') continue
        const where = `${interior.stationId} ${stopId}`
        const layers = exitPathBuffers(interior, r, { ...opts, decks: interiorDecks(interior), dashInStation: r.probable })
        expect(layers.bands.reduce((n, b) => n + b.positions.length, 0), where).toBeGreaterThan(0)
        const line = exitPathCenterline(interior, r, opts).map((q) => q.p)
        expect(line.at(-1)![1], where).toBe(0)
        if (r.exit.entranceId !== null) expect([line.at(-1)![0], line.at(-1)![2]], where).toEqual(r.exit.point)
        drawn++
      }
    }
    expect(drawn).toBeGreaterThan(400)
  })
})
