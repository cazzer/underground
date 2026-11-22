import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Connector, StationInterior as Interior } from '../data/stationSchema'
import { bandCutYs, interiorDecks } from './interiorDecks'
import { buildInteriorBuffers, type Buffers, type InteriorLayers } from './interiorGeometry'
import { color, count, ELEVATOR, fixture, opts, ROLES, seg, STAIR } from './interiorFixture'

const roleIs = (b: Buffers, k: number, role: string) => color(b, k)[0] === ROLES.indexOf(role as (typeof ROLES)[number])
const tags = (b: Buffers) => Array.from({ length: count(b) }, (_, k) => `${ROLES[color(b, k)[0]!]}:${color(b, k)[1]}`)
/** y of every end of a role's segments. */
const ys = (b: Buffers, role: string) =>
  Array.from({ length: count(b) }, (_, k) => k).filter((k) => roleIs(b, k, role)).flatMap((k) => [seg(b, k)[1]!, seg(b, k)[4]!])
const length = (b: Buffers, role: string) =>
  Array.from({ length: count(b) }, (_, k) => k)
    .filter((k) => roleIs(b, k, role))
    .reduce((n, k) => {
      const [ax, ay, az, bx, by, bz] = seg(b, k) as [number, number, number, number, number, number]
      return n + Math.hypot(bx - ax, by - ay, bz - az)
    }, 0)
/** The layers band by band, lowest first: [strong, fine] each. */
const bandsOf = (l: InteriorLayers): [Buffers, Buffers][] => [
  [l.strong, l.fine],
  ...l.mid.map((m): [Buffers, Buffers] => [m.strong, m.fine]),
  [l.overStrong, l.overFine],
]

/** The fixture plus a deeper platform deck at -14 m ('low', level 3), reached from both levels above it. */
function twoDecks(connectors: Connector[]): Interior {
  const base = fixture(connectors)
  base.levels.push({ id: 'low', name: 'Low', kind: 'platform', y: -14 })
  base.platforms.push({ ...base.platforms[0]!, id: 'P2', level: 'low', tracks: [{ stopId: 'Y01N', path: [[-25, 5], [25, 5]] }] })
  return base
}
const from = (c: Connector, id: string, kind: Connector['kind'], upper: string): Connector => ({
  ...c,
  id,
  kind,
  lower: { x: 0, z: 0, level: 'low' },
  upper: { x: 10, z: 0, level: upper },
})

describe('a two-deck interior', () => {
  const toPlat = from(STAIR, 'ST2', 'stair', 'plat')
  const toMezz = from(STAIR, 'ES1', 'escalator', 'mezz')
  const lift: Connector = { ...ELEVATOR, lower: { ...ELEVATOR.lower, level: 'low' } }
  const interior = twoDecks([STAIR, toPlat, toMezz, lift])
  const decks = interiorDecks(interior)
  const whole = buildInteriorBuffers(interior, opts())
  const out = buildInteriorBuffers(interior, opts({ decks }))
  const cuts = bandCutYs(interior, decks, 1.1, 2)

  it('draws three bands: the low deck, the platform deck, then the mezzanine and the street', () => {
    expect(decks).toEqual([3, 2])
    expect(out.mid).toHaveLength(1)
    expect(new Set(tags(out.strong).filter((t) => /^(outline|track)/.test(t)))).toEqual(new Set(['outline:3', 'track:3']))
    expect(new Set(tags(out.mid[0]!.strong).filter((t) => /^(outline|track)/.test(t)))).toEqual(new Set(['outline:2', 'track:2']))
    expect(new Set(tags(out.overStrong).filter((t) => /^outline/.test(t)))).toEqual(new Set(['outline:1']))
  })

  it("cuts a stair from the low deck to the platform deck at the low deck's train roof", () => {
    // The stair role is the fixture's STAIR (mezzanine to street, all over) plus ST2.
    expect(Math.min(...ys(out.strong, 'stair'))).toBeCloseTo(-28)
    expect(Math.max(...ys(out.strong, 'stair'))).toBeCloseTo(cuts[0]!)
    expect(Math.min(...ys(out.mid[0]!.strong, 'stair'))).toBeCloseTo(cuts[0]!)
    expect(Math.max(...ys(out.mid[0]!.strong, 'stair'))).toBeCloseTo(-16)
  })

  it('cuts an escalator and an elevator shaft through three bands at both roofs, conserving their length', () => {
    for (const role of ['escalator', 'elevator']) {
      const [band0, band1, band2] = bandsOf(out).map(([strong]) => strong)
      expect(Math.max(...ys(band0!, role)), role).toBeCloseTo(cuts[0]!)
      expect(Math.min(...ys(band1!, role)), role).toBeCloseTo(cuts[0]!)
      expect(Math.max(...ys(band1!, role)), role).toBeCloseTo(cuts[1]!)
      expect(Math.min(...ys(band2!, role)), role).toBeCloseTo(cuts[1]!)
      const total = bandsOf(out).reduce((n, [strong, fine]) => n + length(strong, role) + length(fine, role), 0)
      expect(total, role).toBeCloseTo(length(whole.strong, role) + length(whole.fine, role))
    }
  })

  it("writes each elevator stop in its own level's band", () => {
    /** y of the flat strong elevator strokes (the doored squares) in a layer. */
    const flat = (b: Buffers) =>
      new Set(Array.from({ length: count(b) }, (_, k) => k).filter((k) => roleIs(b, k, 'elevator') && seg(b, k)[1] === seg(b, k)[4]).map((k) => seg(b, k)[1]))
    expect(flat(out.strong)).toEqual(new Set([-28]))
    expect(flat(out.mid[0]!.strong)).toEqual(new Set())
    expect(flat(out.overStrong)).toEqual(new Set([-8]))
  })
})

describe('Union Sq (635), committed data', () => {
  const union = JSON.parse(readFileSync(new URL('../../public/data/stations/635.json', import.meta.url), 'utf8')) as Interior
  const decks = interiorDecks(union)
  const out = buildInteriorBuffers(union, opts({ decks }))
  const cuts = bandCutYs(union, decks, 1.1, 2)
  const bands = bandsOf(out)

  it('draws the Canarsie platform only in band 0 and the Lexington and Broadway platforms only in the band between', () => {
    expect(bands).toHaveLength(3)
    const deckTags = bands.map(([strong]) => new Set(tags(strong).filter((t) => /^(outline|track):[23]$/.test(t))))
    expect(deckTags).toEqual([new Set(['outline:3', 'track:3']), new Set(['outline:2', 'track:2']), new Set()])
  })

  it("keeps every band's strokes between the train roofs either side of it", () => {
    const bounds = [-Infinity, ...cuts, Infinity]
    bands.forEach(([strong, fine], j) => {
      for (const b of [strong, fine]) {
        for (let k = 0; k < count(b); k++) {
          const s = seg(b, k)
          expect(Math.min(s[1]!, s[4]!), `band ${j}`).toBeGreaterThanOrEqual(bounds[j]! - 1e-4)
          expect(Math.max(s[1]!, s[4]!), `band ${j}`).toBeLessThanOrEqual(bounds[j + 1]! + 1e-4)
        }
      }
    })
  })

  it('cuts the stairs from the L platform at its roof, not the upper deck\'s', () => {
    expect(Math.max(...ys(out.strong, 'stair'))).toBeCloseTo(cuts[0]!)
    expect(ys(out.mid[0]!.strong, 'stair').some((y) => Math.abs(y - cuts[0]!) < 1e-4)).toBe(true)
  })
})
