import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { bandShift, createBandView, writeBandView } from '../bandOffset'
import { vertexBandInputs } from '../lineBuffers'
import { buildPolyline } from '../realtime/polyline'
import { buildTrackProfile, EMPTY_PROFILE, GRADE, profileAt } from '../trackProfile'
import { MAX_CARS } from './consist'
import { createConsistScratch, writeConsist } from './consistLayout'
import { createTrackPoint, trackPointInto, type DrawnTrack } from './trackPoint'

const H = 844
const PITCH = 2.5

/** Top-down at `distance` over (0, 0, -500). */
function view(distance: number) {
  const cam = new PerspectiveCamera(35, 390 / H, 10, 1e6)
  cam.position.set(0, distance, -500 + 0.001)
  cam.up.set(0, 0, -1)
  cam.lookAt(0, 0, -500)
  cam.updateMatrixWorld()
  const v = writeBandView(createBandView(), cam.matrixWorldInverse.elements, cam.projectionMatrix.elements[5]!, H, distance, PITCH, 4.7)
  return { cam, v }
}

/** A northbound straight track, x = 0, from z = 0 to z = -1000, with vertices every 250 m, all at `slot`. */
function banded(slot: number, half = 0): DrawnTrack {
  const points = [0, 250, 500, 750, 1000].map((d) => ({ x: 0, z: -d }))
  const line = buildPolyline(points)
  return { line, profile: EMPTY_PROFILE, bandInputs: vertexBandInputs(points, points.map(() => slot), points.map(() => half)) }
}

describe('trackPointInto', () => {
  it('puts a point on its band, the pitch away from the track on screen, as the shader shifts the vertices', () => {
    const { cam, v } = view(500)
    const track = banded(1)
    const p = trackPointInto(track, 600, v, createTrackPoint())
    // Northbound, so right of travel is east (+x).
    const toPx = (x: number, z: number) => new Vector3(x, 0, z).project(cam).x * (390 / 2)
    expect(toPx(p.x, p.z) - toPx(0, -600)).toBeCloseTo(PITCH, 1)
    expect(p.z).toBeCloseTo(-600, 6)
    // At a vertex it is exactly the vertex shifted by bandShift along its normal.
    const atVertex = trackPointInto(track, 500, v, createTrackPoint())
    expect(atVertex.x).toBeCloseTo(bandShift(v, 0, 0, -500, 1, 0, 1, 0), 9)
  })

  it('moves a track onto the centerline while the direction tracks merge on screen', () => {
    // From 30 km the two tracks, 9.4 m apart, are well under 5 px apart; a lone route (slot 0) still shifts.
    const { v } = view(30_000)
    const p = trackPointInto(banded(0), 500, v, createTrackPoint())
    expect(p.x).toBeCloseTo(-4.7, 6)
  })

  it('takes its height from the profile and clamps to the line', () => {
    const track = { ...banded(0), profile: buildTrackProfile([{ d0: 400, d1: 600, yReal: -10 }], { grade: GRADE, yScale: 2 }).profile }
    const { v } = view(500)
    expect(trackPointInto(track, 500, v, createTrackPoint()).y).toBeCloseTo(profileAt(track.profile, 500), 9)
    const end = trackPointInto(track, 5000, v, createTrackPoint())
    expect(end.z).toBeCloseTo(-1000, 6)
  })

  it('leaves an unwritten view and an empty line in place', () => {
    const p = trackPointInto(banded(1), 300, createBandView(), createTrackPoint())
    expect([p.x, p.z]).toEqual([0, -300])
    const empty: DrawnTrack = { line: buildPolyline([]), profile: EMPTY_PROFILE, bandInputs: new Float32Array(0) }
    const q = trackPointInto(empty, 10, createBandView(), createTrackPoint())
    expect([q.x, q.y, q.z]).toEqual([0, 0, 0])
  })

  it('carries a train consist onto its band too', () => {
    const { v } = view(500)
    const bodies = new Float32Array(MAX_CARS * 16)
    const halos = new Float32Array(MAX_CARS * 16)
    const frame = { gapM: 1, rimM: 0.5, widthM: 3, crossScale: 1, y: 0.5 }
    writeConsist(bodies, halos, 0, banded(-1), v, 500, { cars: 4, pitchM: 15 }, 1, 1, 1, frame, createConsistScratch())
    const shift = bandShift(v, 0, 0, -500, 1, 0, -1, 0)
    expect(shift).toBeLessThan(0)
    for (let c = 0; c < 4; c++) expect(bodies[c * 16 + 12]).toBeCloseTo(shift, 3)
  })
})
