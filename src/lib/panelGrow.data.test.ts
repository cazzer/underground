/**
 * The panel-grow reframe (ost.18) on the committed street files: a bare station landed on a 390×844 phone under the
 * three-destination panel, before the Entrances row arrived, then kept or reframed once the row has grown the panel.
 * The free-rect bottoms come from docs/evidence/ost.11/README.md: 337.5 px with the row (measured 5 s after landing),
 * so 393.5 px without it (the row is `mt-3` plus a `min-h-11` toggle, 56 px).
 */
import { describe, expect, it } from 'vitest'
import stationsRaw from '../../public/data/stations.json?raw'
import raw120 from '../../public/data/streets/120.json?raw'
import raw127 from '../../public/data/streets/127.json?raw'
import type { StationsFile } from '../data/schema'
import type { StationStreets } from '../data/streetSchema'
import { COLLAPSE_FOV } from './collapseFixture'
import { moveGains } from './collapseReframe'
import { entranceLocal } from './entranceMarks'
import { bareStationFrame, framedCount, type FramePoint } from './freeFrame'
import { toGround, type Ground } from './projection'

const stations = (JSON.parse(stationsRaw) as StationsFile).stations
const viewport = { width: 390, height: 844 }
const BEFORE = { left: 0, top: 60, right: 390, bottom: 393.5 }
const AFTER = { left: 0, top: 60, right: 390, bottom: 337.5 }
const level = (p: Ground): FramePoint => ({ x: p.x, y: 0, z: p.z })

function setup(id: string, raw: string) {
  const s = stations.find((st) => st.id === id)
  if (!s) throw new Error(`no station ${id}`)
  const file = JSON.parse(raw) as StationStreets
  const anchor = toGround(file.anchor)
  const points = file.entrances.map((_, i) => {
    const m = entranceLocal(file, i)
    return { x: anchor.x + m.x, z: anchor.z + m.z }
  })
  return { station: toGround(s), points }
}

function counts(id: string, raw: string) {
  const { station, points } = setup(id, raw)
  const tiers = [[level(station)], points.map(level)]
  const base = { station, points, azimuth: 0, viewport, fovDeg: COLLAPSE_FOV }
  const landing = bareStationFrame({ ...base, free: BEFORE })
  const next = bareStationFrame({ ...base, free: AFTER })
  const view = { azimuth: 0, viewport, free: AFTER, fovDeg: COLLAPSE_FOV }
  return {
    here: tiers.map((t) => framedCount(view, landing, t)),
    there: tiers.map((t) => framedCount(view, next, t)),
    totals: tiers.map((t) => t.length),
  }
}

describe('a bare station whose phone panel grows after landing', () => {
  it('127: reframes, framing 10 of its 16 entrance marks where the landing keeps 8 above the grown panel', () => {
    const { here, there, totals } = counts('127', raw127)
    expect(totals).toEqual([1, 16])
    expect(here).toEqual([1, 8])
    expect(there).toEqual([1, 10])
    expect(moveGains('resize', here, there, totals)).toBe(true)
  })

  it('120: stays, since no framing within the target radius shows more than the 2 of 6 it keeps', () => {
    const { here, there, totals } = counts('120', raw120)
    expect(totals).toEqual([1, 6])
    expect(here).toEqual([1, 2])
    expect(there).toEqual([1, 2])
    expect(moveGains('resize', here, there, totals)).toBe(false)
  })
})
