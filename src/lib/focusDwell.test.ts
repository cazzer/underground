import { describe, expect, it } from 'vitest'
import { ENTER_DWELL_S, newDwell, settled, STILL_FRACTION } from './focusDwell'

const at = { x: 100, z: -50 }

describe('settled', () => {
  it('is true only after the view holds still for ENTER_DWELL_S', () => {
    const s = newDwell()
    expect(settled(s, 0, at, 1000, false)).toBe(false)
    expect(settled(s, ENTER_DWELL_S - 0.01, at, 1000, false)).toBe(false)
    expect(settled(s, ENTER_DWELL_S, at, 1000, false)).toBe(true)
  })

  it('ignores drift within STILL_FRACTION of the distance, measured from where the wait started', () => {
    const s = newDwell()
    settled(s, 0, at, 1000, false)
    const eps = STILL_FRACTION * 1000
    expect(settled(s, 0.2, { x: at.x + eps * 0.9, z: at.z }, 1000 + eps * 0.5, false)).toBe(false)
    expect(settled(s, 0.4, { x: at.x + eps * 0.9, z: at.z - eps * 0.9 }, 1000, false)).toBe(true)
  })

  it('restarts the wait on a move past the threshold', () => {
    const s = newDwell()
    settled(s, 0, at, 1000, false)
    const eps = STILL_FRACTION * 1000
    expect(settled(s, 0.3, { x: at.x + eps * 1.5, z: at.z }, 1000, false)).toBe(false)
    expect(settled(s, 0.6, { x: at.x + eps * 1.5, z: at.z }, 1000, false)).toBe(false)
    expect(settled(s, 0.71, { x: at.x + eps * 1.5, z: at.z }, 1000, false)).toBe(true)
  })

  it('restarts on a zoom past the threshold', () => {
    const s = newDwell()
    settled(s, 0, at, 1000, false)
    expect(settled(s, 0.5, at, 990, false)).toBe(false)
    expect(settled(s, 0.9, at, 990, false)).toBe(true)
  })

  it('never settles while a gesture is active, and waits again after it ends', () => {
    const s = newDwell()
    settled(s, 0, at, 1000, false)
    expect(settled(s, 1, at, 1000, true)).toBe(false)
    expect(settled(s, 1.2, at, 1000, false)).toBe(false)
    expect(settled(s, 1.41, at, 1000, false)).toBe(true)
  })

  it('a pan across the city never settles while it keeps moving', () => {
    const s = newDwell()
    for (let i = 0; i <= 120; i++) {
      // 60 fps, 300 m/s at 1000 m: 5 m a frame, past the 2 m threshold every frame.
      expect(settled(s, i / 60, { x: at.x + 5 * i, z: at.z }, 1000, false)).toBe(false)
    }
  })
})
