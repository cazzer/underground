/**
 * A bare station's landing (bareStationFrame) on the committed street files at 390×844, azimuth 0 (ost.18). The open
 * station panel leaves the free rect's bottom at 393.5 px: ost.11 measured 337.5 px with the live three-destination
 * panel and the Entrances row (docs/evidence/ost.11/README.md), and #123 made that row screen-reader only, giving back
 * its 56 px (`mt-3` plus a `min-h-11` toggle). The collapsed bar leaves 690 px (collapseFixture.ts). A growth after
 * landing is the outage disclosure arriving (`mt-2` plus a `min-h-11` toggle, 52 px).
 */
import { describe, expect, it } from 'vitest'
import stationsRaw from '../../public/data/stations.json?raw'
import raw120 from '../../public/data/streets/120.json?raw'
import raw127 from '../../public/data/streets/127.json?raw'
import type { StationsFile } from '../data/schema'
import type { StationStreets } from '../data/streetSchema'
import { COLLAPSE_FOV, PHONE_COLLAPSED } from './collapseFixture'
import { moveGains } from './collapseReframe'
import { entranceLocal } from './entranceMarks'
import { bareStationFrame, framedCount, type BareStationFrame, type FramePoint } from './freeFrame'
import type { ScreenRect } from './interiorCamera'
import { toGround, type Ground } from './projection'

const stations = (JSON.parse(stationsRaw) as StationsFile).stations
const viewport = { width: 390, height: 844 }
const OPEN: ScreenRect = { left: 0, top: 60, right: 390, bottom: 393.5 }
const OUTAGE_ROW_PX = 52
const GROWN: ScreenRect = { ...OPEN, bottom: OPEN.bottom - OUTAGE_ROW_PX }
const level = (p: Ground): FramePoint => ({ x: p.x, y: 0, z: p.z })

function tiersOf(id: string, raw: string) {
  const s = stations.find((st) => st.id === id)
  if (!s) throw new Error(`no station ${id}`)
  const file = JSON.parse(raw) as StationStreets
  const anchor = toGround(file.anchor)
  const points = file.entrances.map((_, i) => {
    const m = entranceLocal(file, i)
    return { x: anchor.x + m.x, z: anchor.z + m.z }
  })
  const station = toGround(s)
  return { station, points, tiers: [[level(station)], points.map(level)] }
}

/** The station and marks a camera at `frame` keeps in `free`, by tier. */
function kept(id: string, raw: string, frame: BareStationFrame, free: ScreenRect): number[] {
  const view = { azimuth: 0, viewport, free, fovDeg: COLLAPSE_FOV }
  return tiersOf(id, raw).tiers.map((t) => framedCount(view, frame, t))
}

function land(id: string, raw: string, free: ScreenRect): BareStationFrame {
  const { station, points } = tiersOf(id, raw)
  return bareStationFrame({ station, points, azimuth: 0, viewport, free, fovDeg: COLLAPSE_FOV })
}

describe('bare station landings on a 390×844 phone', () => {
  it('under the open panel: 127 keeps 10 of its 16 marks, 120 2 of 6', () => {
    expect(kept('127', raw127, land('127', raw127, OPEN), OPEN)).toEqual([1, 10])
    expect(kept('120', raw120, land('120', raw120, OPEN), OPEN)).toEqual([1, 2])
  })

  it('with the panel collapsed to its bar: every mark of 127 and 120', () => {
    const bar = PHONE_COLLAPSED.free
    expect(kept('127', raw127, land('127', raw127, bar), bar)).toEqual([1, 16])
    expect(kept('120', raw120, land('120', raw120, bar), bar)).toEqual([1, 6])
  })

  it('the outage disclosure arriving just after landing: 127 reframes from 8 to 10 marks, 120 stays at 2', () => {
    const grow = (id: string, raw: string) => {
      const totals = tiersOf(id, raw).tiers.map((t) => t.length)
      const here = kept(id, raw, land(id, raw, OPEN), GROWN)
      const there = kept(id, raw, land(id, raw, GROWN), GROWN)
      return { here, there, moves: moveGains('resize', here, there, totals) }
    }
    expect(grow('127', raw127)).toEqual({ here: [1, 8], there: [1, 10], moves: true })
    expect(grow('120', raw120)).toEqual({ here: [1, 2], there: [1, 2], moves: false })
  })
})
