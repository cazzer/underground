import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { interiorFreeRect, type ScreenRect } from './interiorCamera'
import type { Station } from './network'
import type { Ground } from './projection'
import { buildPolyline } from './realtime/polyline'
import { EXIT_DISTANCE } from './focusMachine'
import { frameTopDown, legStationPoints, ROUTE_MIN_DISTANCE, ROUTE_PAD_PX, routeFramePoints } from './routeFrame'
import { tiltT } from './tilt'
import type { SpanShape, TripSpan } from './tripSpans'

const FOV = 35
const MIN = ROUTE_MIN_DISTANCE
const MAX = 500_000
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }
const phoneFree = interiorFreeRect(PHONE, { top: 60, bottom: 24 }, { left: 0, top: 480, right: 390, bottom: 844 })
const desktopFree = interiorFreeRect(DESKTOP, { top: 60, bottom: 24 }, { left: 1040, top: 60, right: 1440, bottom: 876 })

/** A ground point's viewport px for a camera straight above `target` at `distance`. */
function project(p: Ground, f: { distance: number; target: Ground }, viewport: { width: number; height: number }) {
  const mpp = (2 * f.distance * Math.tan((FOV * Math.PI) / 360)) / viewport.height
  return { x: viewport.width / 2 + (p.x - f.target.x) / mpp, y: viewport.height / 2 + (p.z - f.target.z) / mpp }
}
function inside(px: { x: number; y: number }, free: ScreenRect, pad: number): boolean {
  const e = 1e-6
  return px.x >= free.left + pad - e && px.x <= free.right - pad + e && px.y >= free.top + pad - e && px.y <= free.bottom - pad + e
}
const frame = (pts: Ground[], viewport: typeof PHONE, free: ScreenRect, max = MAX) => frameTopDown(pts, viewport, free, FOV, MIN, max)

describe('frameTopDown', () => {
  it('frames one point at the minimum distance, on the point mid-free-area', () => {
    const p = { x: 1234, z: -567 }
    const f = frame([p], PHONE, phoneFree)
    expect(f.distance).toBe(MIN)
    const px = project(p, f, PHONE)
    expect(px.x).toBeCloseTo(195, 6)
    expect(px.y).toBeCloseTo((phoneFree.top + phoneFree.bottom) / 2, 6)
  })

  it('fits a wide route by width above a stacked phone panel, every point inside the padded free rect', () => {
    const pts = [
      { x: -9000, z: 100 },
      { x: 9000, z: -300 },
      { x: 0, z: 200 },
    ]
    const f = frame(pts, PHONE, phoneFree)
    expect(f.distance).toBeGreaterThan(MIN)
    for (const p of pts) expect(inside(project(p, f, PHONE), phoneFree, ROUTE_PAD_PX)).toBe(true)
    const [a, b] = [project(pts[0]!, f, PHONE), project(pts[1]!, f, PHONE)]
    expect(a.x).toBeCloseTo(ROUTE_PAD_PX, 6)
    expect(b.x).toBeCloseTo(PHONE.width - ROUTE_PAD_PX, 6)
  })

  it('fits a tall route by height', () => {
    const pts = [
      { x: 0, z: -12_000 },
      { x: 500, z: 12_000 },
    ]
    const f = frame(pts, PHONE, phoneFree)
    const [a, b] = pts.map((p) => project(p, f, PHONE))
    expect(a!.y).toBeCloseTo(phoneFree.top + ROUTE_PAD_PX, 6)
    expect(b!.y).toBeCloseTo(phoneFree.bottom - ROUTE_PAD_PX, 6)
  })

  it('centers on the free area left of a desktop side panel', () => {
    const pts = [
      { x: -4000, z: -2000 },
      { x: 4000, z: 2000 },
    ]
    const f = frame(pts, DESKTOP, desktopFree)
    expect(desktopFree.right).toBe(1024)
    const mid = project({ x: 0, z: 0 }, f, DESKTOP)
    expect(mid.x).toBeCloseTo(512, 6)
    for (const p of pts) expect(inside(project(p, f, DESKTOP), desktopFree, ROUTE_PAD_PX)).toBe(true)
  })

  it('stays centered and overflows when the zoom limit clamps the distance', () => {
    const pts = [
      { x: -20_000, z: 0 },
      { x: 20_000, z: 0 },
    ]
    const f = frame(pts, PHONE, phoneFree, 5000)
    expect(f.distance).toBe(5000)
    const mid = project({ x: 0, z: 0 }, f, PHONE)
    expect(mid.x).toBeCloseTo(195, 6)
  })

  it('never lands at or under the focus machine\'s exit distance, so focus drops, and stays top-down', () => {
    const f = frame([{ x: 0, z: 0 }, { x: 300, z: 100 }], PHONE, phoneFree)
    expect(f.distance).toBeGreaterThan(EXIT_DISTANCE)
    expect(tiltT(f.distance)).toBe(0)
  })

  it('gives finite numbers for a degenerate free rect', () => {
    const f = frame([{ x: 0, z: 0 }, { x: 800, z: 800 }], PHONE, { left: 10, top: 10, right: 10, bottom: 10 })
    expect(Number.isFinite(f.distance)).toBe(true)
    expect(Number.isFinite(f.target.x) && Number.isFinite(f.target.z)).toBe(true)
  })

  it('throws on no points', () => {
    expect(() => frame([], PHONE, phoneFree)).toThrow(/at least one point/)
  })
})

describe('frameTopDown through a three camera', () => {
  it.each([
    ['phone', PHONE, phoneFree],
    ['desktop', DESKTOP, desktopFree],
  ])('puts every point inside the padded free rect, %s', (_, viewport, free) => {
    const pts = [
      { x: -3500, z: 2100 },
      { x: 4200, z: -1800 },
      { x: 300, z: 2600 },
    ]
    const f = frame(pts, viewport, free)
    // As CameraRig places the camera for a top-down flight: straight above the target, a hair south, looking at it.
    const camera = new PerspectiveCamera(FOV, viewport.width / viewport.height, 1, 1e6)
    camera.position.set(f.target.x, f.distance, f.target.z + 0.001)
    camera.lookAt(f.target.x, 0, f.target.z)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    for (const p of pts) {
      const ndc = new Vector3(p.x, 0, p.z).project(camera)
      const px = { x: ((ndc.x + 1) / 2) * viewport.width, y: ((1 - ndc.y) / 2) * viewport.height }
      expect(inside(px, free, ROUTE_PAD_PX - 0.5)).toBe(true)
    }
  })
})

function shape(id: string, pts: Ground[]): SpanShape {
  const { points, cumulative, length } = buildPolyline(pts)
  return { id, routeId: 'X', direction: 'N', primary: true, points: [...points], cumulative: [...cumulative], length }
}
const shapes = new Map([['s1', shape('s1', [{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 300 }])]])

describe('routeFramePoints', () => {
  const stations: Ground[] = [{ x: 7, z: 8 }]
  it('takes a ride\'s stretch of its shape including the bend between its ends', () => {
    const span: TripSpan = { kind: 'ride', legIndex: 0, routeId: 'X', shapeId: 's1', d0: 100, d1: 600, maxOffsetM: 0, matched: 'route' }
    expect(routeFramePoints([span], shapes, [])).toEqual([
      { x: 100, z: 0 },
      { x: 400, z: 0 },
      { x: 400, z: 200 },
    ])
  })

  it('takes a straight span\'s points, a walk\'s ends and the stations', () => {
    const straight: TripSpan = { kind: 'straight', legIndex: 0, routeId: 'X', points: [{ x: 1, z: 2 }, { x: 3, z: 4 }] }
    const walk: TripSpan = { kind: 'walk', legIndex: 1, fromStationId: 'A', toStationId: 'B', sameComplex: false, from: { x: 5, z: 6 }, to: { x: 9, z: 9 } }
    expect(routeFramePoints([straight, walk], shapes, stations)).toEqual([{ x: 1, z: 2 }, { x: 3, z: 4 }, { x: 5, z: 6 }, { x: 9, z: 9 }, { x: 7, z: 8 }])
  })

  it('names a shape the map does not draw', () => {
    const span: TripSpan = { kind: 'ride', legIndex: 0, routeId: 'X', shapeId: 'gone', d0: 0, d1: 1, maxOffsetM: 0, matched: 'route' }
    expect(() => routeFramePoints([span], shapes, [])).toThrow(/gone/)
  })
})

describe('legStationPoints', () => {
  const station = (id: string, x: number): Station => ({ id, name: id, pos: { x, z: 0 }, routeIds: [], stops: [`${id}N`], access: { status: 'none' }, leadId: id })
  const stops = new Map([['AN', station('A', 1)], ['BN', station('B', 2)], ['CN', station('C', 3)]])
  const ride = { kind: 'ride' as const, routeId: 'X', tripId: 't', patternKey: 'p', boardStop: 'AN', alightStop: 'BN', stops: ['AN', 'BN'], live: false, departAt: 0, arriveAt: 1, terminalStop: 'BN' }
  const walk = { kind: 'walk' as const, fromStop: 'BN', toStop: 'CN', sameStation: false, startAt: 1, durationS: 60, endAt: 61 }

  it('lists each leg\'s board and alight, or the walk\'s ends', () => {
    expect(legStationPoints([ride, walk], stops).map((p) => p.x)).toEqual([1, 2, 2, 3])
  })
  it('throws for a stop no station lists', () => {
    expect(() => legStationPoints([{ ...ride, alightStop: 'ZN' }], stops)).toThrow(/ZN/)
  })
})
