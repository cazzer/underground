/**
 * A covered station's amenity row at the landing on its interior, on the committed interiors of every listed station
 * (Union Sq 635, Woodlawn 401 and the generated ones): inside the free rect at a phone with its station panel open
 * and at a desktop, checked with three's own camera, as pathFrame.data.test poses it.
 */
import { readFileSync } from 'node:fs'
import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { AmenitiesFile } from '../data/amenitiesSchema'
import type { StationIndex, StationInterior } from '../data/stationSchema'
import { markSizesInto, newMarkSizes } from '../scene/amenitySizes'
import { coveredRow, orbitProjector } from './amenityCovered'
import { groupAmenities } from './amenityGlyphs'
import { rightX, rightZ, rowCentreInto } from './amenityPlacement'
import type { Viewport } from './framing'
import { stationAxis } from './interiorAxis'
import { frameInterior, landingAzimuth, LANDING_DISTANCE, type ScreenRect } from './interiorCamera'
import { FOCUS_FRAME_PAD_M, FOOTPRINT_PAD_M, interiorFootprint } from './interiorFootprint'
import { interiorFocusAnchor } from './interiorFraming'
import { toGround } from './projection'
import { ISO_POLAR, tiltForDistance } from './tilt'

const FOV = 35
const Y = 2
const EXTRA = FOCUS_FRAME_PAD_M - FOOTPRINT_PAD_M
/** The free rects the app measures with the station panel open (complexFrame.data.test's). */
const VIEWS: [string, Viewport, ScreenRect][] = [
  ['phone 390x844', { width: 390, height: 844 }, { left: 0, top: 60, right: 390, bottom: 393.5 }],
  ['desktop 1440x900', { width: 1440, height: 900 }, { left: 0, top: 60, right: 1120, bottom: 833 }],
]

const read = <T>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, 'utf8')) as T
const amenities = read<AmenitiesFile>('stations/amenities.json')
const index = read<StationIndex>('stations/index.json')
/** Every interior file one of whose stations the amenities file lists, with that row's mark count. */
const files = [...new Set(Object.keys(amenities.stations).flatMap((id) => (index.stations[id] ? [index.stations[id]!.file ?? id] : [])))].sort()

function threeProject(target: { x: number; z: number }, azimuth: number, v: Viewport) {
  const polar = tiltForDistance(LANDING_DISTANCE)
  const cam = new PerspectiveCamera(FOV, v.width / v.height, 1, 1e6)
  const back = new Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth))
  const t = new Vector3(target.x, 0, target.z)
  cam.position.copy(t).addScaledVector(back, LANDING_DISTANCE)
  cam.lookAt(t)
  cam.updateMatrixWorld()
  return (x: number, z: number) => {
    const ndc = new Vector3(x, 0, z).project(cam)
    return { x: ((ndc.x + 1) / 2) * v.width, y: ((1 - ndc.y) / 2) * v.height }
  }
}

describe('orbitProjector', () => {
  it('projects ground points as three does', () => {
    const v = { width: 390, height: 844 }
    for (const az of [0, 0.8, -2.4]) {
      const target = { x: 120, z: -340 }
      const ours = orbitProjector(target, LANDING_DISTANCE, tiltForDistance(LANDING_DISTANCE), az, v, FOV)
      const theirs = threeProject(target, az, v)
      for (const [x, z] of [[120, -340], [180, -300], [60, -420]] as const) {
        const a = ours(x, z)!
        const b = theirs(x, z)
        expect(a.x).toBeCloseTo(b.x, 3)
        expect(a.y).toBeCloseTo(b.y, 3)
      }
    }
  })
})

describe('a covered station amenity row at the landing', () => {
  it('covers Union Sq, Woodlawn and the generated interiors', () => {
    expect(files).toContain('635')
    expect(files).toContain('401')
    expect(files.length).toBeGreaterThan(10)
  })

  for (const [name, viewport, free] of VIEWS) {
    for (const id of files) {
      it(`sits inside the free rect at ${id} on a ${name}`, () => {
        const interior = read<StationInterior>(`stations/${id}.json`)
        const origin = toGround(interior.anchor)
        const footprint = interiorFootprint(interior, Y, origin)
        const anchor = interiorFocusAnchor(origin, interior, Y, Math.tan(ISO_POLAR))
        const axis = stationAxis(interior)
        const n = groupAmenities(amenities.stations, interior.memberStationIds ?? [interior.stationId]).kinds.length
        const sizes = markSizesInto(newMarkSizes(), LANDING_DISTANCE, false)
        const row = coveredRow(footprint, anchor, axis, n, sizes, EXTRA, { viewport, free, fovDeg: FOV })
        expect(row.fits).toBe(true)
        // Independently, with three's camera at the landing.
        const az = landingAzimuth(axis, 0, free)
        const { target } = frameInterior({ ...anchor, azimuth: az, viewport, free, fovDeg: FOV })
        const toPx = threeProject(target, az, viewport)
        const c = { x: 0, z: 0 }
        for (let k = 0; k < n; k++) {
          rowCentreInto(c, k, n, row.origin, row.dir, Math.max(row.reach, sizes.clear), sizes.plate, sizes.gap, az)
          for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            const px = toPx(c.x + sizes.plate * (a * rightX(az) - b * rightZ(az)), c.z + sizes.plate * (a * rightZ(az) + b * rightX(az)))
            expect(px.x).toBeGreaterThanOrEqual(free.left)
            expect(px.x).toBeLessThanOrEqual(free.right)
            expect(px.y).toBeGreaterThanOrEqual(free.top)
            expect(px.y).toBeLessThanOrEqual(free.bottom)
          }
        }
      })
    }
  }
})
