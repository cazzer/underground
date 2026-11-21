import { describe, expect, it } from 'vitest'
import { frameInterior, interiorFreeRect, type InteriorFrameInput } from './interiorCamera'
import { ISO_POLAR } from './tilt'

const viewport = { width: 1440, height: 900 }
const insets = { top: 70, bottom: 90 }

describe('interiorFreeRect', () => {
  it('is the band between the header and footer without a panel', () => {
    expect(interiorFreeRect(viewport, insets, null)).toEqual({ left: 0, top: 70, right: 1440, bottom: 810 })
  })

  it('stops left of a right-hand panel', () => {
    const panel = { left: 1136, top: 628, right: 1424, bottom: 884 }
    expect(interiorFreeRect(viewport, insets, panel, 16)).toEqual({ left: 0, top: 70, right: 1120, bottom: 810 })
  })

  it('stops above a stacked panel', () => {
    const phone = { width: 390, height: 844 }
    const panel = { left: 16, top: 500, right: 374, bottom: 760 }
    expect(interiorFreeRect(phone, insets, panel, 16).bottom).toBe(484)
  })
})

const base: InteriorFrameInput = {
  center: { x: 1000, z: 2000 },
  width: 50,
  length: 40,
  depth: 18,
  viewport,
  free: { left: 0, top: 0, right: 1440, bottom: 900 },
  fovDeg: 35,
  polar: ISO_POLAR,
  minDistance: 180,
  pad: 0,
}
const mpp = (d: number) => (2 * d * Math.tan((35 * Math.PI) / 360)) / 900

describe('frameInterior', () => {
  it('keeps the minimum distance and the center when it fits the whole viewport', () => {
    expect(frameInterior(base)).toEqual({ distance: 180, target: { x: 1000, z: 2000 } })
  })

  it('pulls back until the plan width fits the free width', () => {
    const { distance } = frameInterior({ ...base, width: 200 })
    expect(200 / mpp(distance)).toBeCloseTo(1440)
  })

  it('pulls back for the projected height: length at cos, depth at sin', () => {
    const { distance } = frameInterior({ ...base, length: 250, depth: 30 })
    const h = 250 * Math.cos(ISO_POLAR) + 30 * Math.sin(ISO_POLAR)
    expect(h / mpp(distance)).toBeCloseTo(900)
  })

  it('shifts the target east when the free rect is left of center, so the interior moves left', () => {
    const { distance, target } = frameInterior({ ...base, free: { left: 0, top: 0, right: 1120, bottom: 900 } })
    expect(distance).toBe(180)
    expect(target.x).toBeCloseTo(1000 + 160 * mpp(180))
    expect(target.z).toBe(2000)
  })

  it('shifts the target north when the free band is below center, like frameBounds', () => {
    const { target } = frameInterior({ ...base, free: { left: 0, top: 100, right: 1440, bottom: 900 } })
    expect(target.z).toBeCloseTo(2000 - (50 * mpp(180)) / Math.cos(ISO_POLAR))
  })
})
