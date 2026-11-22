/**
 * A bare station complex's landing (bareStationFrame with its other members, 2q7.42) on the committed stations and street
 * files, at azimuth 0, against the lead-only landing it replaces (the same call without `members`). Counts are by tier:
 * the lead's point, the other members' points, the lead's street-file entrance marks (a complex's file holds the
 * members' shared entrances within 260 m of the lead). The phone panels are panelGrow.data.test.ts's.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationStreets } from '../data/streetSchema'
import { entranceLocal } from './entranceMarks'
import { ENTER_RADIUS } from './focusMachine'
import { bareStationFrame, framedCount, freeFrame, STATION_ONLY_RADIUS_M, TARGET_RADIUS_M, type FramePoint } from './freeFrame'
import type { Viewport } from './framing'
import type { ScreenRect } from './interiorCamera'
import { complexPanRadius, PAN_RADIUS_BARE, PAN_RADIUS_MAX } from './orbitLimits'
import { showsMore } from './pathFrame'
import { toGround, type Ground } from './projection'
import { realFile, realGroupById, realStations } from './realGroups.testdata'

const FOV = 35
const VIEWS: Record<'phoneOpen' | 'phoneBar' | 'desktop', { viewport: Viewport; free: ScreenRect }> = {
  phoneOpen: { viewport: { width: 390, height: 844 }, free: { left: 0, top: 60, right: 390, bottom: 393.5 } },
  phoneBar: { viewport: { width: 390, height: 844 }, free: { left: 0, top: 60, right: 390, bottom: 690 } },
  desktop: { viewport: { width: 1440, height: 900 }, free: { left: 0, top: 60, right: 1120, bottom: 833 } },
}
type ViewName = keyof typeof VIEWS

const pos = new Map(realStations.map((s) => [s.id, s.pos]))
const level = (p: Ground): FramePoint => ({ x: p.x, y: 0, z: p.z })
const gap = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)

function marksOf(id: string): Ground[] {
  const file = JSON.parse(readFileSync(`public/data/streets/${id}.json`, 'utf8')) as StationStreets
  const anchor = toGround(file.anchor)
  return file.entrances.map((_, i) => {
    const m = entranceLocal(file, i)
    return { x: anchor.x + m.x, z: anchor.z + m.z }
  })
}

function complex(lead: string) {
  const ids = realGroupById.get(lead)!.memberIds
  if (ids[0] !== lead) throw new Error(`${lead} is not a lead`)
  return { station: pos.get(lead)!, members: ids.slice(1).map((id) => pos.get(id)!), points: marksOf(lead) }
}

/** Tier counts of the lead-only landing and the complex landing in one view, and the complex landing's target. */
function landings(lead: string, name: ViewName) {
  const { station, members, points } = complex(lead)
  const view = { azimuth: 0, fovDeg: FOV, ...VIEWS[name] }
  const tiers = [[level(station)], members.map(level), points.map(level)]
  const count = (f: { distance: number; target: Ground }) => tiers.map((t) => framedCount(view, f, t))
  const after = bareStationFrame({ station, points, members, ...view })
  return { before: count(bareStationFrame({ station, points, ...view })), after: count(after), target: after.target, members: [station, ...members] }
}

describe('a bare complex lands on its members as well as its lead', () => {
  it('Times Sq-42 St (725 with 127, 902, A27, R16; 266 m to Port Authority)', () => {
    expect(landings('725', 'phoneOpen')).toMatchObject({ before: [1, 1, 9], after: [1, 3, 16] })
    expect(landings('725', 'phoneBar')).toMatchObject({ before: [1, 2, 16], after: [1, 3, 16] })
    expect(landings('725', 'desktop')).toMatchObject({ before: [1, 4, 17], after: [1, 4, 17] })
  })

  it('Canal St (639, 156 m) and Fulton St (A38, 155 m) under the open phone panel', () => {
    expect(landings('639', 'phoneOpen')).toMatchObject({ before: [1, 1, 7], after: [1, 3, 14] })
    expect(landings('A38', 'phoneOpen')).toMatchObject({ before: [1, 1, 7], after: [1, 2, 14] })
  })

  it('never frames less, and lands within reach of a member so focus stays (every complex, every view)', () => {
    const complexes = realFile.complexes ?? []
    expect(complexes.length).toBeGreaterThan(30)
    for (const ids of complexes) {
      for (const name of Object.keys(VIEWS) as ViewName[]) {
        const { before, after, target, members } = landings(ids[0]!, name)
        expect(showsMore(before, after), `${ids[0]} ${name}`).toBe(false)
        // focusMachine: the focused distance is the nearest member's, and only past ENTER_RADIUS may focus switch.
        const near = Math.min(...members.map((m) => gap(m, target)))
        expect(near, `${ids[0]} ${name}`).toBeLessThanOrEqual((after[0] === 1 ? TARGET_RADIUS_M : STATION_ONLY_RADIUS_M) + 1e-6)
        expect(near).toBeLessThan(ENTER_RADIUS)
      }
    }
  })
})

describe('a lone station', () => {
  it('lands exactly as before: the station required, its marks nearest first, the target within the bare radius of it', () => {
    for (const id of ['120', '101', 'L08']) {
      expect(realGroupById.get(id)!.memberIds).toEqual([id])
      const station = pos.get(id)!
      const points = marksOf(id)
      for (const v of Object.values(VIEWS)) {
        const view = { azimuth: 0, fovDeg: FOV, ...v }
        const wanted = [...points].sort((a, b) => gap(a, station) - gap(b, station)).map(level)
        const old = freeFrame({
          required: [level(station)],
          wanted,
          center: level(station),
          anchors: [station],
          centerRadius: PAN_RADIUS_BARE,
          fallbackRadius: STATION_ONLY_RADIUS_M,
          ...view,
        })
        expect(bareStationFrame({ station, points, members: [], ...view })).toEqual(old)
      }
    }
  })
})

describe("a bare complex's pan radius on real data", () => {
  it('joins every complex within the cap; Times Sq reaches Port Authority', () => {
    const radii = new Map((realFile.complexes ?? []).map((ids) => [ids[0]!, complexPanRadius(ids.map((id) => pos.get(id)!))]))
    for (const r of radii.values()) {
      expect(r).toBeGreaterThanOrEqual(PAN_RADIUS_BARE)
      expect(r).toBeLessThanOrEqual(PAN_RADIUS_MAX)
    }
    expect(Math.round(radii.get('725')!)).toBe(153)
    expect(Math.round(radii.get('L02')!)).toBe(166)
    expect(radii.get('A24')).toBe(PAN_RADIUS_BARE)
  })
})
