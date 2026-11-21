import { describe, expect, it } from 'vitest'
import { frameInterior, interiorFreeRect, type InteriorFrameInput } from './interiorCamera'
import { ENTER_RADIUS, EXIT_DISTANCE } from './focusMachine'
import { interiorOpacity } from './interiorReveal'
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

const center = { x: 1000, z: 2000 }
const mpp = (d: number, height: number) => (2 * d * Math.tan((35 * Math.PI) / 360)) / height

describe('frameInterior', () => {
  const cases: [string, InteriorFrameInput][] = [
    [
      'desktop 1440x900, panel on the right',
      { center, viewport, fovDeg: 35, free: interiorFreeRect(viewport, insets, { left: 1136, top: 628, right: 1424, bottom: 884 }) },
    ],
    [
      'phone 390x844, panel stacked above the footer',
      {
        center,
        viewport: { width: 390, height: 844 },
        fovDeg: 35,
        free: interiorFreeRect({ width: 390, height: 844 }, { top: 80, bottom: 70 }, { left: 16, top: 470, right: 374, bottom: 770 }),
      },
    ],
    ['a tiny free rect', { center, viewport, fovDeg: 35, free: { left: 0, top: 70, right: 40, bottom: 90 } }],
  ]

  it.each(cases)('%s: stays at full reveal and keeps the station focused', (_, input) => {
    const { distance, target } = frameInterior(input)
    expect(distance).toBeLessThanOrEqual(180)
    expect(interiorOpacity(distance)).toBe(1)
    expect(distance).toBeLessThan(EXIT_DISTANCE)
    // The view center stays close enough that the camera-driven focus keeps this station.
    expect(Math.hypot(target.x - center.x, target.z - center.z)).toBeLessThan(ENTER_RADIUS)
  })

  it('keeps the center when the free rect is the whole viewport', () => {
    const free = { left: 0, top: 0, right: 1440, bottom: 900 }
    expect(frameInterior({ center, viewport, free, fovDeg: 35 })).toEqual({ distance: 180, target: center })
  })

  it('shifts the target east when the free rect is left of center, so the interior moves left', () => {
    const { target } = frameInterior({ center, viewport, fovDeg: 35, free: { left: 0, top: 0, right: 1120, bottom: 900 } })
    expect(target.x).toBeCloseTo(1000 + 160 * mpp(180, 900))
    expect(target.z).toBe(2000)
  })

  it('shifts the target north when the free band is below center, like frameBounds', () => {
    const { target } = frameInterior({ center, viewport, fovDeg: 35, free: { left: 0, top: 100, right: 1440, bottom: 900 } })
    expect(target.z).toBeCloseTo(2000 - (50 * mpp(180, 900)) / Math.cos(ISO_POLAR))
  })
})
