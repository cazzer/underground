import { describe, expect, it } from 'vitest'
import { markSelected, meaningfulChange, MOVING_MS, newPose, newReselect, reselectDue, STILL_MS, type ViewPose } from './reselect'

const pose = (over: Partial<ViewPose> = {}): ViewPose => ({ ...newPose(), distance: 1000, width: 800, height: 600, ...over })

describe('meaningfulChange', () => {
  it('ignores small pans, zooms and turns', () => {
    expect(meaningfulChange(pose(), pose({ tx: 90, distance: 1100, azimuth: 0.1 }))).toBe(false)
  })

  it('counts a pan past a tenth of the distance, a 15% zoom, a 10° turn or a resize', () => {
    expect(meaningfulChange(pose(), pose({ tx: 101 }))).toBe(true)
    expect(meaningfulChange(pose(), pose({ distance: 1160 }))).toBe(true)
    expect(meaningfulChange(pose(), pose({ distance: 840 }))).toBe(true)
    expect(meaningfulChange(pose(), pose({ azimuth: 0.2 }))).toBe(true)
    expect(meaningfulChange(pose({ azimuth: 3.1 }), pose({ azimuth: -3.1 }))).toBe(false)
    expect(meaningfulChange(pose(), pose({ width: 801 }))).toBe(true)
  })
})

describe('reselectDue', () => {
  it('fires on the first frame', () => {
    expect(reselectDue(newReselect(), pose(), 0)).toBe(true)
  })

  it('waits for the view to hold still, then fires', () => {
    const s = newReselect()
    reselectDue(s, pose(), 0)
    markSelected(s, pose(), 900)
    expect(reselectDue(s, pose({ tx: 50 }), 1000)).toBe(false)
    expect(reselectDue(s, pose({ tx: 200 }), 1016)).toBe(false)
    expect(reselectDue(s, pose({ tx: 200 }), 1016 + STILL_MS - 1)).toBe(false)
    expect(reselectDue(s, pose({ tx: 200 }), 1016 + STILL_MS)).toBe(true)
  })

  it('fires at a steady pace while the view keeps moving', () => {
    const s = newReselect()
    reselectDue(s, pose(), 0)
    markSelected(s, pose(), 0)
    let fired = 0
    for (let t = 16, x = 0; t <= 2000; t += 16) {
      x += 20
      if (reselectDue(s, pose({ tx: x }), t)) {
        fired++
        markSelected(s, pose({ tx: x }), t)
      }
    }
    expect(fired).toBeGreaterThanOrEqual(3)
    expect(fired).toBeLessThanOrEqual(2000 / MOVING_MS + 1)
  })

  it('stays quiet while the view holds still', () => {
    const s = newReselect()
    reselectDue(s, pose(), 0)
    markSelected(s, pose(), 0)
    for (let t = 16; t < 3000; t += 16) expect(reselectDue(s, pose(), t)).toBe(false)
  })
})
