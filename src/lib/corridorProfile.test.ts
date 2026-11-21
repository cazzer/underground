import { describe, expect, it } from 'vitest'
import { slotProfile, suppressBlips } from './corridorProfile'
import { profileAt } from './trackProfile'

describe('suppressBlips', () => {
  it('drops an out-and-back run shorter than minRun, and keeps a longer one or a real change', () => {
    const v = Float64Array.from([1, 1, 1, 2, 2, 1, 1, 1, 3, 3, 3, 3, 1, 1, 0, 0, 0])
    suppressBlips(v, 3)
    expect([...v]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 1, 1, 0, 0, 0])
  })

  it('repeats until none is left', () => {
    const v = Float64Array.from([0, 0, 0, 1, 2, 1, 0, 0, 0])
    suppressBlips(v, 4)
    expect([...v]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('slotProfile', () => {
  const dist = Float64Array.from({ length: 41 }, (_, i) => i * 100)

  it('eases each change over the taper, centered between the two samples', () => {
    const values = Float64Array.from(dist, (d) => (d < 1000 ? -1 : -0.5))
    const p = slotProfile(values, dist, 4000, 300)
    expect([...p.d]).toEqual([800, 1100])
    expect(profileAt(p, 500)).toBe(-1)
    expect(profileAt(p, 950)).toBeCloseTo(-0.75)
    expect(profileAt(p, 1500)).toBe(-0.5)
  })

  it('eases changes closer than the taper as one, from the first value to the last', () => {
    // -1 until 1000, -0.5 until 1200, then 0.
    const values = Float64Array.from(dist, (d) => (d < 1000 ? -1 : d < 1200 ? -0.5 : 0))
    const p = slotProfile(values, dist, 4000, 300)
    expect([...p.d]).toEqual([800, 1300])
    expect([...p.y]).toEqual([-1, 0])
  })

  it('drops a cluster that returns to where it started, and eases changes a taper apart separately', () => {
    const blip = Float64Array.from(dist, (d) => (d >= 1000 && d < 1200 ? 1 : 0))
    expect(slotProfile(blip, dist, 4000, 300).d.length).toBe(0)
    const steps = Float64Array.from(dist, (d) => (d < 1000 ? 0 : d < 1400 ? 1 : 2))
    expect([...slotProfile(steps, dist, 4000, 300).d]).toEqual([800, 1100, 1200, 1500])
  })

  it('is empty when the slot is 0 throughout, and one knot when it is constant', () => {
    expect(slotProfile(new Float64Array(5), dist.subarray(0, 5), 400, 300).d.length).toBe(0)
    expect([...slotProfile(new Float64Array(5).fill(1.5), dist.subarray(0, 5), 400, 300).y]).toEqual([1.5])
  })
})
