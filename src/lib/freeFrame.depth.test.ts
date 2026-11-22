/** freeFrame beyond a bare station: points below the street, several anchors, and framedCount. */
import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { framedCount, freeFrame, FRAME_PAD_PX, TARGET_RADIUS_M, type FramePoint, type FreeFrame, type FreeFrameInput } from './freeFrame'
import type { Viewport } from './framing'
import { depthFactor, tiltForDistance } from './tilt'

const FOV = 35
const PHONE: Viewport = { width: 390, height: 844 }
const STATION = { x: 1200, z: -3400 }

/** Screen px of a point drawn at its height × the depth factor, by three's projection of an OrbitControls pose. */
function project(p: FramePoint, f: FreeFrame, azimuth: number, v: Viewport) {
  const polar = tiltForDistance(f.distance)
  const cam = new PerspectiveCamera(FOV, v.width / v.height, 1, 1e6)
  const back = new Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth))
  const t = new Vector3(f.target.x, 0, f.target.z)
  cam.position.copy(t).addScaledVector(back, f.distance)
  cam.lookAt(t)
  cam.updateMatrixWorld()
  const ndc = new Vector3(p.x, p.y * depthFactor(f.distance), p.z).project(cam)
  return { x: ((ndc.x + 1) / 2) * v.width, y: ((1 - ndc.y) / 2) * v.height }
}

function input(over: Partial<FreeFrameInput>): FreeFrameInput {
  return {
    required: [],
    wanted: [],
    center: { ...STATION, y: 0 },
    anchors: [STATION],
    centerRadius: 200,
    azimuth: 0.4,
    viewport: PHONE,
    free: { left: 0, top: 60, right: 390, bottom: 560 },
    fovDeg: FOV,
    ...over,
  }
}

const PAD = FRAME_PAD_PX - 0.5
const inside = (p: FramePoint, i: FreeFrameInput, f: FreeFrame) => {
  const s = project(p, f, i.azimuth, i.viewport)
  return s.x >= i.free.left + PAD && s.x <= i.free.right - PAD && s.y >= i.free.top + PAD && s.y <= i.free.bottom - PAD
}

describe('freeFrame with depth', () => {
  it('frames points 20 m down where three draws them at the depth factor, not where their street point is', () => {
    // A deep platform run 40 m long north-west of the station, and the street end of its stair.
    const deep: FramePoint[] = [
      { x: STATION.x - 60, y: -20, z: STATION.z - 40 },
      { x: STATION.x - 20, y: -20, z: STATION.z - 40 },
      { x: STATION.x - 30, y: 0, z: STATION.z - 30 },
    ]
    const i = input({ wanted: deep })
    const f = freeFrame(i)
    expect(f.kept).toHaveLength(3)
    for (const p of deep) expect(inside(p, i, f)).toBe(true)
    expect(framedCount(i, f, deep)).toBe(3)
    // Its depth moves it on screen: framing the street point instead would frame the wrong place.
    const flat = (p: FramePoint) => project({ ...p, y: 0 }, f, i.azimuth, i.viewport).y
    expect(Math.abs(flat(deep[0]!) - project(deep[0]!, f, i.azimuth, i.viewport).y)).toBeGreaterThan(5)
  })

  it('counts only the points a pose keeps in the padded rect', () => {
    const i = input({})
    const f = freeFrame(i)
    const far: FramePoint = { x: STATION.x + 2000, y: 0, z: STATION.z }
    expect(framedCount(i, f, [{ ...STATION, y: 0 }, far])).toBe(inside({ ...STATION, y: 0 }, i, f) ? 1 : 0)
  })
})

describe('freeFrame with several anchors', () => {
  it('prefers the anchor that keeps a higher-priority point over one that keeps more lower-priority points', () => {
    const far = { x: STATION.x + 400, z: STATION.z }
    // First in priority: one point by the station. Then two by the far anchor, which no frame near the station reaches.
    const first: FramePoint = { x: STATION.x - 10, y: 0, z: STATION.z - 30 }
    const later: FramePoint[] = [
      { x: far.x - 10, y: 0, z: far.z - 30 },
      { x: far.x + 10, y: 0, z: far.z - 40 },
    ]
    const i = input({ wanted: [first, ...later], anchors: [far, STATION], centerRadius: 1e4 })
    expect(freeFrame({ ...i, anchors: [far] }).kept).toEqual(later)
    expect(freeFrame({ ...i, anchors: [STATION] }).kept).toEqual([first])
    const f = freeFrame(i)
    expect(f.kept).toEqual([first])
    expect(Math.hypot(f.target.x - STATION.x, f.target.z - STATION.z)).toBeLessThanOrEqual(TARGET_RADIUS_M + 1e-6)
  })

  it('holds the target near the anchor that lets it keep the most points', () => {
    const near = { x: STATION.x + 400, z: STATION.z }
    const pts: FramePoint[] = [
      { x: near.x - 10, y: 0, z: near.z - 30 },
      { x: near.x + 10, y: 0, z: near.z - 40 },
    ]
    const i = input({ wanted: pts, anchors: [STATION, near], center: { ...near, y: 0 }, centerRadius: 1e4 })
    const f = freeFrame(i)
    expect(f.kept).toHaveLength(2)
    expect(Math.hypot(f.target.x - near.x, f.target.z - near.z)).toBeLessThanOrEqual(TARGET_RADIUS_M + 1e-6)
    // With only the far anchor, nothing fits within its radius.
    expect(freeFrame({ ...i, anchors: [STATION] }).kept).toHaveLength(0)
  })
})
