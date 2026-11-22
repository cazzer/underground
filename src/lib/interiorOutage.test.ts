import { describe, expect, it } from 'vitest'
import type { Connector } from '../data/stationSchema'
import { buildInteriorBuffers, type Buffers, type InteriorRole } from './interiorGeometry'
import { color, count, ELEVATOR, fixture, opts, ROLES, STAIR } from './interiorFixture'

const roleCount = (b: Buffers, role: InteriorRole) =>
  Array.from({ length: count(b) }, (_, k) => color(b, k)).filter((c) => c[0] === ROLES.indexOf(role)).length

const ESCALATOR: Connector = {
  ...STAIR,
  id: 'ES1',
  kind: 'escalator',
  lower: { x: 0, z: 10, level: 'plat' },
  upper: { x: 14, z: 10, level: 'mezz' },
  travel: 'up',
}

const out = (...ids: string[]) => ({ outOfService: (id: string) => ids.includes(id) })

describe('an out-of-service elevator', () => {
  const interior = fixture([STAIR, ELEVATOR])
  const normal = buildInteriorBuffers(interior, opts())
  const outaged = buildInteriorBuffers(interior, opts(out('EL1')))

  it('draws its shaft and stops in the outage role and crosses out each cab', () => {
    expect(roleCount(outaged.strong, 'elevator')).toBe(0)
    expect(roleCount(outaged.fine, 'elevator')).toBe(0)
    expect(roleCount(outaged.strong, 'outage')).toBe(roleCount(normal.strong, 'elevator'))
    // Two stops, each with the cab's four edges and its two diagonals.
    expect(roleCount(outaged.fine, 'outage')).toBe(2 * (4 + 2))
    expect(count(outaged.fine)).toBe(count(normal.fine) + 4)
    expect(count(outaged.strong)).toBe(count(normal.strong))
  })

  it('leaves every other segment as it was', () => {
    expect(roleCount(outaged.strong, 'stair')).toBe(roleCount(normal.strong, 'stair'))
    expect(roleCount(outaged.fine, 'step')).toBe(roleCount(normal.fine, 'step'))
  })

  it('draws buffers identical to no option when nothing is out', () => {
    const none = buildInteriorBuffers(interior, opts(out()))
    for (const k of ['strong', 'fine', 'overStrong', 'overFine'] as const) {
      expect(Array.from(none[k].positions)).toEqual(Array.from(normal[k].positions))
      expect(Array.from(none[k].colors)).toEqual(Array.from(normal[k].colors))
    }
  })

  it('ignores ids the interior does not have', () => {
    const other = buildInteriorBuffers(interior, opts(out('EL9')))
    expect(Array.from(other.fine.colors)).toEqual(Array.from(normal.fine.colors))
  })
})

describe('an out-of-service escalator', () => {
  const interior = fixture([STAIR, ESCALATOR])
  const normal = buildInteriorBuffers(interior, opts())
  const outaged = buildInteriorBuffers(interior, opts(out('ES1')))

  it('loses its travel chevrons, gains a cross, and draws band and rails in the outage role', () => {
    const run = 14
    const chevrons = Math.floor(run / 4.5) * 2
    expect(roleCount(normal.strong, 'escalator')).toBe(4 + chevrons)
    expect(roleCount(outaged.strong, 'escalator')).toBe(0)
    expect(roleCount(outaged.strong, 'outage')).toBe(4 + 2)
    expect(roleCount(outaged.fine, 'outage')).toBe(2)
    expect(roleCount(outaged.fine, 'escalator')).toBe(0)
  })

  it('draws the cross corner to corner across the band at mid-run', () => {
    const k = Array.from({ length: count(outaged.strong) }, (_, i) => i).filter(
      (i) => color(outaged.strong, i)[0] === ROLES.indexOf('outage'),
    )
    const cross = k.slice(-2).map((i) => Array.from(outaged.strong.positions.subarray(i * 6, i * 6 + 6)))
    for (const s of cross) {
      // Half a width along the run, a full width across it, around mid-run (x = 7).
      expect(Math.abs(s[3]! - s[0]!)).toBeCloseTo(2)
      expect(Math.abs(s[5]! - s[2]!)).toBeCloseTo(2)
      expect((s[0]! + s[3]!) / 2).toBeCloseTo(7)
    }
  })
})

describe('an out-of-service machine through the split', () => {
  const interior = fixture([STAIR, ELEVATOR, ESCALATOR])
  const split = buildInteriorBuffers(interior, opts({ splitLevel: 2, ...out('EL1', 'ES1') }))

  it('colors the segments on both sides of the cut, and none keep a working machine color', () => {
    for (const layer of ['strong', 'overStrong'] as const) {
      expect(roleCount(split[layer], 'outage'), layer).toBeGreaterThan(0)
      expect(roleCount(split[layer], 'elevator'), layer).toBe(0)
      expect(roleCount(split[layer], 'escalator'), layer).toBe(0)
    }
    expect(roleCount(split.fine, 'outage')).toBeGreaterThan(0)
    expect(roleCount(split.fine, 'elevator') + roleCount(split.overFine, 'elevator')).toBe(0)
  })

  it('keeps each elevator stop with its level: the platform stop under the trains, the mezzanine stop over', () => {
    // The platform stop's cab (4 edges + 2 diagonals) stays in the base fine layer, the mezzanine's goes over.
    expect(roleCount(split.fine, 'outage')).toBeGreaterThanOrEqual(6)
    expect(roleCount(split.overFine, 'outage')).toBeGreaterThanOrEqual(6)
  })
})
