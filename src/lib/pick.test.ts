import { describe, expect, it } from 'vitest'
import { choosePick, nearestStation, segmentDistancePx, STATION_HIT_PX, TRAIN_HIT_PX, TRAIN_TOUCH_HIT_PX, trainHitPx, type ToScreen } from './pick'

/** Top-down, 1 px per meter; anything with y below -100 counts as behind the camera. */
const ortho: ToScreen = (x, y, z, out) => {
  out.x = x
  out.y = z
  return y > -100
}

/** Markers drawn 5 m across: inside the 22 px target at 1 px per meter. */
const SMALL = () => 5

const POSITIONS = [
  { x: 0, z: 0 },
  { x: 100, z: 0 },
  { x: 40, z: 0 },
]

describe('segmentDistancePx', () => {
  it('measures to the segment, clamped to its ends', () => {
    expect(segmentDistancePx({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(segmentDistancePx({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
    expect(segmentDistancePx({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
  })
})

describe('nearestStation', () => {
  it('hits within the radius and misses outside it', () => {
    expect(nearestStation(POSITIONS, ortho, { x: 0, y: STATION_HIT_PX }, SMALL)?.index).toBe(0)
    expect(nearestStation([{ x: 0, z: 0 }], ortho, { x: 0, y: STATION_HIT_PX + 0.5 }, SMALL)).toBeNull()
  })

  it('picks the station nearest the pointer when targets overlap', () => {
    expect(nearestStation(POSITIONS, ortho, { x: 90, y: 5 }, SMALL)?.index).toBe(1)
    expect(nearestStation(POSITIONS, ortho, { x: 30, y: 0 }, SMALL)).toEqual({ index: 2, distancePx: 10 })
  })

  it('takes the whole drawn marker when it is bigger than the target', () => {
    const big = (i: number) => (i === 0 ? 40 : 5)
    expect(nearestStation([{ x: 0, z: 0 }], ortho, { x: 35, y: 0 }, big)?.index).toBe(0)
    expect(nearestStation([{ x: 0, z: 0 }], ortho, { x: 41, y: 0 }, big)).toBeNull()
    expect(nearestStation([{ x: 0, z: 0 }, { x: 100, z: 0 }], ortho, { x: 70, y: 0 }, big)).toBeNull()
  })

  it('skips stations behind the camera', () => {
    const behind: ToScreen = (x, _y, z, out) => {
      out.x = x
      out.y = z
      return x !== 0
    }
    expect(nearestStation([{ x: 0, z: 0 }], behind, { x: 0, y: 0 }, SMALL)).toBeNull()
  })
})

describe('choosePick', () => {
  it('prefers the station unless the train is at least 6 px closer', () => {
    expect(choosePick({ index: 1, distancePx: 10 }, { index: 7, distancePx: 5 })).toEqual({ kind: 'station', index: 1 })
    expect(choosePick({ index: 1, distancePx: 10 }, { index: 7, distancePx: 4 })).toEqual({ kind: 'train', index: 7 })
    expect(choosePick({ index: 1, distancePx: 3 }, { index: 7, distancePx: 3 })).toEqual({ kind: 'station', index: 1 })
  })

  it('lets a train in reach win at the station that is already open', () => {
    expect(choosePick({ index: 1, distancePx: 2 }, { index: 7, distancePx: 3 }, 1)).toEqual({ kind: 'train', index: 7 })
    expect(choosePick({ index: 1, distancePx: 2 }, { index: 7, distancePx: 3 }, 0)).toEqual({ kind: 'station', index: 1 })
    expect(choosePick({ index: 1, distancePx: 2 }, null, 1)).toEqual({ kind: 'station', index: 1 })
  })

  it('takes whichever exists, or nothing', () => {
    expect(choosePick(null, { index: 2, distancePx: 15 })).toEqual({ kind: 'train', index: 2 })
    expect(choosePick({ index: 0, distancePx: 20 }, null)).toEqual({ kind: 'station', index: 0 })
    expect(choosePick(null, null)).toBeNull()
  })
})

describe('trainHitPx', () => {
  it('gives a touch the bigger train target only with no station in reach', () => {
    expect(trainHitPx(true, null)).toBe(TRAIN_TOUCH_HIT_PX)
    expect(trainHitPx(true, { index: 0, distancePx: 10 })).toBe(TRAIN_HIT_PX)
    expect(trainHitPx(false, null)).toBe(TRAIN_HIT_PX)
  })

  it('gives a touch the bigger train target at the open station, whose marker is hidden', () => {
    expect(trainHitPx(true, { index: 4, distancePx: 3 }, 4)).toBe(TRAIN_TOUCH_HIT_PX)
    expect(trainHitPx(true, { index: 4, distancePx: 3 }, 2)).toBe(TRAIN_HIT_PX)
    expect(trainHitPx(false, { index: 4, distancePx: 3 }, 4)).toBe(TRAIN_HIT_PX)
    // A train within the touch target beside the hidden open station wins; with none, the station is picked.
    expect(choosePick({ index: 4, distancePx: 2 }, { index: 9, distancePx: TRAIN_TOUCH_HIT_PX - 1 }, 4)).toEqual({ kind: 'train', index: 9 })
    expect(choosePick({ index: 4, distancePx: 2 }, null, 4)).toEqual({ kind: 'station', index: 4 })
  })
})
