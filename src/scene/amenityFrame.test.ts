import { describe, expect, it } from 'vitest'
import type { AmenityMark } from '../lib/amenityPlacement'
import { newPresence } from '../lib/presence'
import { newAmenityFrame, tierShare, writeAmenityFrame, type TierArrays } from './amenityFrame'
import { markSizesInto, newMarkSizes } from './amenitySizes'

const SAMPLES = Array.from({ length: 51 }, (_, i) => i / 50)
/** How much of the under copy's ink the veil leaves (it dims the street layers under it); 1 with no veil. */
const VEILS = [1, 0.35]

const mark: AmenityMark = { stationId: 'A', memberIds: ['A'], kind: 'restroom', k: 0, n: 1, pos: { x: 0, z: 0 }, dir: { x: 0, z: -1 } }
const tiers = (): { under: TierArrays; over: TierArrays } => ({
  under: { plate: new Float32Array(16), glyph: { restroom: new Float32Array(16), csc: new Float32Array(0) } },
  over: { plate: new Float32Array(16), glyph: { restroom: new Float32Array(16), csc: new Float32Array(0) } },
})
/** An instance's x scale (its first column's length). */
const scaleOf = (m: Float32Array) => Math.hypot(m[0]!, m[1]!, m[2]!)

/**
 * The ink the mark shows at its glyph's shape, as a share of full ink: the over copy draws above the veil at full ink,
 * the under copy below it at `veil`; an over plate knocks out everything under it, and a glyph only adds ink where it
 * reaches. With the over plate down, the over glyph must be whole; without it, the under copy must be whole.
 */
function ink(under: { glyph: number; plate: number }, over: { glyph: number; plate: number }, veil: number): number {
  const whole = (v: number) => v >= 1 - 1e-6
  if (over.plate > 1e-6) return whole(over.glyph) ? 1 : 0
  if (whole(under.glyph)) return veil
  return whole(over.glyph) ? 1 : 0
}

describe('the amenity marks hand-off between tiers', () => {
  it('never dips below the dimmer copy at any presence, with or without the veil (tierShare)', () => {
    let lastOver = 0
    for (const p of SAMPLES) {
      const under = tierShare(0, p)
      const over = tierShare(1, p)
      expect(over.glyph, `p ${p}`).toBeGreaterThanOrEqual(lastOver)
      lastOver = over.glyph
      for (const veil of VEILS) expect(ink(under, over, veil), `p ${p} veil ${veil}`).toBeGreaterThanOrEqual(Math.min(veil, 1))
    }
    expect(tierShare(0, 0)).toEqual({ glyph: 1, plate: 1 })
    expect(tierShare(1, 0)).toEqual({ glyph: 0, plate: 0 })
    expect(tierShare(0, 1)).toEqual({ glyph: 0, plate: 0 })
    expect(tierShare(1, 1)).toEqual({ glyph: 1, plate: 1 })
  })

  it('writes the same in the frame writer, every plate at full size or none', () => {
    const f = newAmenityFrame([mark])
    const presence = newPresence('X')
    f.cover[0] = presence
    const t = tiers()
    const sizes = markSizesInto(newMarkSizes(), 600, false)
    const s = sizes.glyph
    for (const p of SAMPLES) {
      presence.value = p
      writeAmenityFrame(f, t, sizes, 600, 0.3, 0.8, false)
      const share = (a: Float32Array) => scaleOf(a) / s
      const under = { glyph: share(t.under.glyph.restroom), plate: share(t.under.plate) }
      const over = { glyph: share(t.over.glyph.restroom), plate: share(t.over.plate) }
      for (const v of [under.plate, over.plate]) expect([0, 1].some((e) => Math.abs(v - e) < 1e-6), `p ${p} plate ${v}`).toBe(true)
      for (const veil of VEILS) expect(ink(under, over, veil), `p ${p} veil ${veil}`).toBeGreaterThanOrEqual(Math.min(veil, 1) - 1e-6)
    }
  })
})
