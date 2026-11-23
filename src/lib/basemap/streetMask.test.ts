import { describe, expect, it, vi } from 'vitest'
import { edgeFade } from '../streetBuffers'
import { claimMaskSlot, createStreetMask, MASK_N, maskAlpha, maskAlphaAt, maskInner, releaseMaskSlot, writeMaskSlot } from './streetMask'

describe('maskAlpha', () => {
  it('is the exact complement of the station layer at full strength', () => {
    for (const radiusM of [50, 150, 300]) {
      const [inner, outer] = [maskInner(radiusM), radiusM]
      for (let r = 0; r <= radiusM + 50; r += 2.5) {
        // The station layer shows 1 - edgeFade of its stroke; the road keeps the rest.
        expect(maskAlpha(r, inner, outer, 1) + (1 - edgeFade(r, radiusM)), `radius ${radiusM} r ${r}`).toBeCloseTo(1, 9)
      }
    }
  })

  it('scales with the station layer opacity, and leaves roads alone without one', () => {
    const [inner, outer] = [maskInner(300), 300]
    expect(maskAlpha(0, inner, outer, 0.4)).toBeCloseTo(0.6, 12)
    expect(maskAlpha(0, inner, outer, 0)).toBe(1)
    expect(maskAlpha(1000, inner, outer, 1)).toBe(1)
  })

  it('never divides by zero for a radius of 0', () => {
    const [inner, outer] = [maskInner(0), 0]
    expect(maskAlpha(0, inner, outer, 1)).toBe(0)
    expect(maskAlpha(1, inner, outer, 1)).toBe(1)
  })
})

describe('maskAlphaAt', () => {
  it('leaves every road alone with no disc', () => {
    expect(maskAlphaAt(0, 0, [])).toBe(1)
  })

  it('is maskAlpha of the distance for one disc', () => {
    const disc = { x: 100, z: -50, inner: maskInner(300), outer: 300, strength: 0.8 }
    for (const [x, z] of [[100, -50], [360, -50], [100, 230], [500, 500]] as const) {
      expect(maskAlphaAt(x, z, [disc])).toBe(maskAlpha(Math.hypot(x - 100, z + 50), disc.inner, disc.outer, 0.8))
    }
  })

  it('keeps the least alpha where discs overlap', () => {
    const a = { x: 0, z: 0, inner: 230, outer: 300, strength: 1 }
    const b = { x: 400, z: 0, inner: 130, outer: 200, strength: 0.5 }
    expect(maskAlphaAt(250, 0, [a, b])).toBeCloseTo(Math.min(maskAlpha(250, 230, 300, 1), maskAlpha(150, 130, 200, 0.5)), 12)
    expect(maskAlphaAt(400, 0, [a, b])).toBeCloseTo(0.5, 12)
    expect(maskAlphaAt(0, 0, [b, a])).toBe(0)
  })
})

describe('mask slots', () => {
  it('claims distinct slots, writes each on its own and frees them for reuse', () => {
    const mask = createStreetMask()
    expect(mask.slots).toHaveLength(MASK_N)
    const a = claimMaskSlot(mask)!
    const b = claimMaskSlot(mask)!
    expect(a).not.toBe(b)
    expect(mask.slots[a]!.present).toBe(false)
    writeMaskSlot(mask, a, 1, 2, 300)
    writeMaskSlot(mask, b, 3, 4, 150)
    expect(mask.slots[a]).toEqual({ claimed: true, present: true, x: 1, z: 2, radiusM: 300 })
    expect(mask.slots[b]).toEqual({ claimed: true, present: true, x: 3, z: 4, radiusM: 150 })
    releaseMaskSlot(mask, a)
    expect(mask.slots[a]!.present).toBe(false)
    expect(mask.slots[b]!.present).toBe(true)
    expect(claimMaskSlot(mask)).toBe(a)
  })

  it('returns no slot when full, logging once, and never throws', () => {
    const mask = createStreetMask()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < MASK_N; i++) expect(claimMaskSlot(mask)).toBe(i)
    expect(claimMaskSlot(mask)).toBeNull()
    expect(claimMaskSlot(mask)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('throws on writing or releasing a slot not claimed', () => {
    const mask = createStreetMask()
    expect(() => writeMaskSlot(mask, 0, 0, 0, 300)).toThrow(/slot 0 is not claimed/)
    expect(() => releaseMaskSlot(mask, MASK_N)).toThrow(/not claimed/)
  })
})
