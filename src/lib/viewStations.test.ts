import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import type { StationGroup } from './stationGroups'
import { interiorFreeRect, LANDING_DISTANCE, type ScreenRect } from './interiorCamera'
import type { ScreenPoint, ToScreen } from './pick'
import { newPose } from './basemap/reselect'
import { ISO_POLAR } from './tilt'
import {
  chooseViewStations,
  gateZone,
  MAX_VIEW_STATIONS,
  newViewScratch,
  REACH_SHARE,
  sameMembers,
  viewMovedEnough,
  viewStationSpace,
  type ViewQuery,
  type ViewStationSpace,
} from './viewStations'

const W = 1000
const H = 800
const MPP = 1 // meters per px of the synthetic top-down view
const FREE: ScreenRect = { left: 0, top: 100, right: 1000, bottom: 700 }

/** Top-down: the target is at the canvas middle, 1 px per meter. */
function topDown(tx: number, tz: number): ToScreen {
  return (x, _y, z, out) => {
    out.x = (x - tx) / MPP + W / 2
    out.y = (z - tz) / MPP + H / 2
    return true
  }
}

interface G {
  id: string
  members?: [number, number][]
  at?: [number, number]
}

/** Groups with ground points; `at` is a lone station's point (x, z), `members` a complex's, the lead first. */
function space(groups: G[]): ViewStationSpace {
  const stations = new Map<string, { pos: { x: number; z: number } }>()
  const list = groups.map((g) => {
    const pts = g.members ?? [g.at!]
    const ids = pts.map((_, i) => (i === 0 ? g.id : `${g.id}.${i}`))
    ids.forEach((id, i) => stations.set(id, { pos: { x: pts[i]![0], z: pts[i]![1] } }))
    return { id: g.id, pos: stations.get(g.id)!.pos, memberIds: ids } as unknown as StationGroup
  })
  return viewStationSpace(list, stations)
}

/** A group at the screen point (px, py) of the top-down view with the target at the origin. */
const px = (id: string, x: number, y: number): G => ({ id, at: [(x - W / 2) * MPP, (y - H / 2) * MPP] })

function query(over: Partial<ViewQuery> = {}): ViewQuery {
  return { distance: 800, tx: 0, tz: 0, free: FREE, toScreen: topDown(0, 0), focused: -1, previous: new Int32Array(MAX_VIEW_STATIONS), previousCount: 0, ...over }
}

function run(sp: ViewStationSpace, q: ViewQuery): string[] {
  const out = new Int32Array(MAX_VIEW_STATIONS)
  const n = chooseViewStations(sp, q, newViewScratch(sp), out)
  return Array.from(out.subarray(0, n), (i) => sp.ids[i]!)
}

function prev(sp: ViewStationSpace, ids: string[]): Pick<ViewQuery, 'previous' | 'previousCount'> {
  const previous = new Int32Array(MAX_VIEW_STATIONS)
  ids.forEach((id, i) => (previous[i] = sp.indexOf.get(id)!))
  return { previous, previousCount: ids.length }
}

describe('distance gate', () => {
  it('chooses nothing from REVEAL_FAR out, focused or not, and the station just inside', () => {
    const sp = space([px('A', 500, 400)])
    expect(run(sp, query({ distance: 1250 }))).toEqual([])
    expect(run(sp, query({ distance: 1250, focused: 0 }))).toEqual([])
    expect(run(sp, query({ distance: 1249 }))).toEqual(['A'])
  })
})

describe('free rect', () => {
  const sp = space([px('header', 500, 99), px('panelBelow', 500, 701), px('panelRight', 1001, 400), px('in', 500, 101), px('edge', 999, 699)])
  it('leaves out stations under the header band, below a phone panel and right of a desktop panel', () => {
    expect(run(sp, query())).toEqual(expect.not.arrayContaining(['header', 'panelBelow', 'panelRight']))
    expect(run(sp, query()).sort()).toEqual(['edge', 'in'])
  })
  it('follows the free rect a panel leaves', () => {
    const phone = interiorFreeRect({ width: W, height: H }, { top: 100, bottom: 100 }, { left: 0, top: 416, right: W, bottom: H })
    expect(phone.bottom).toBe(400)
    const ids = run(space([px('above', 500, 390), px('under', 500, 410)]), query({ free: phone }))
    expect(ids).toEqual(['above'])
  })
})

describe('projection', () => {
  it('leaves out a point toScreen rejects', () => {
    const sp = space([px('A', 500, 400), px('B', 520, 400)])
    const reject: ToScreen = (x, y, z, out) => (x > 0 ? false : topDown(0, 0)(x, y, z, out))
    expect(run(sp, query({ toScreen: reject }))).toEqual(['A'])
  })
})

describe('horizon reach', () => {
  it('keeps points within REACH_SHARE x the distance and drops those past it', () => {
    const everywhere: ToScreen = (_x, _y, _z, out) => {
      out.x = 500
      out.y = 400
      return true
    }
    const d = 1000
    const sp = space([{ id: 'in', at: [1.4 * d, 0] }, { id: 'out', at: [0, 1.6 * d] }])
    expect(REACH_SHARE).toBe(1.5)
    expect(run(sp, query({ distance: d, toScreen: everywhere }))).toEqual(['in'])
  })
})

describe('complexes', () => {
  it('is chosen by a member in view, scored by the nearest member', () => {
    const lead = px('X', 1500, 400)
    const m = px('x', 500, 400).at!
    const sp = space([{ id: 'X', members: [lead.at!, m] }, px('far', 900, 400)])
    expect(run(sp, query())).toEqual(['X', 'far'])
  })
})

describe('ranking', () => {
  it('ranks by distance to the free rect middle, not the viewport middle', () => {
    const sp = space([px('mid', 500, 400), px('low', 500, 650)])
    expect(run(sp, query())).toEqual(['mid', 'low'])
    // A panel leaves the top band free: its middle is 150 and the order flips.
    const top: ScreenRect = { left: 0, top: 100, right: 1000, bottom: 200 }
    const sp2 = space([px('mid', 500, 190), px('low', 500, 150)])
    expect(run(sp2, query({ free: top }))).toEqual(['low', 'mid'])
  })
})

describe('focused', () => {
  const far: G[] = [px('F', 5000, 400), px('a', 500, 400), px('b', 510, 400), px('c', 520, 400), px('d', 530, 400), px('e', 540, 400)]
  it('is first even far outside the rect, counts toward the cap and is not duplicated', () => {
    const sp = space(far)
    expect(run(sp, query({ distance: 800, focused: 0 }))).toEqual(['F', 'a', 'b', 'c'])
    expect(run(sp, query({ focused: sp.indexOf.get('a')! }))).toEqual(['a', 'b', 'c', 'd'])
  })
  it('leaves four others with none focused', () => {
    expect(run(space(far), query())).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('cap', () => {
  it('keeps the four nearest of seven, ties to the lower group index', () => {
    const sp = space([px('g0', 400, 400), px('g1', 600, 400), px('g2', 500, 300), px('g3', 500, 500), px('g4', 100, 400), px('g5', 900, 400), px('g6', 500, 150)])
    expect(run(sp, query())).toEqual(['g0', 'g1', 'g2', 'g3'])
  })
})

describe('cap order', () => {
  it('lets a later, nearer group push an earlier, farther one out', () => {
    const sp = space([px('g0', 900, 400), px('g1', 850, 400), px('g2', 800, 400), px('g3', 750, 400), px('g4', 520, 400), px('g5', 510, 400)])
    expect(run(sp, query())).toEqual(['g5', 'g4', 'g3', 'g2'])
  })
})

describe('gate hysteresis', () => {
  const sp = space([px('A', 500, 400), px('B', 520, 400), px('C', 5000, 400)])
  it('becomes non-empty only below REVEAL_FAR', () => {
    expect(run(sp, query({ distance: 1260 }))).toEqual([])
  })
  it('keeps a previous set, its own members only, until REVEAL_FAR x 1.04', () => {
    const p = prev(sp, ['A'])
    expect(run(sp, query({ distance: 1260, ...p }))).toEqual(['A'])
    expect(run(sp, query({ distance: 1260, focused: sp.indexOf.get('B')!, ...p }))).toEqual(['A'])
    expect(run(sp, query({ distance: 1260, focused: sp.indexOf.get('A')!, ...p }))).toEqual(['A'])
    expect(run(sp, query({ distance: 1301, ...p }))).toEqual([])
  })
  it('names the zones', () => {
    expect([gateZone(1249), gateZone(1250), gateZone(1299), gateZone(1300)]).toEqual([0, 1, 1, 2])
  })
})

describe('viewMovedEnough', () => {
  const base = { ...newPose(), distance: 1000, width: 390, height: 844 }
  it('counts a 25 px pan, a 3% zoom, a 3 degree turn and a resize, not less', () => {
    expect(viewMovedEnough(base, { ...base, tx: 19 })).toBe(false)
    expect(viewMovedEnough(base, { ...base, tx: 21 })).toBe(true)
    expect(viewMovedEnough(base, { ...base, distance: 1025 })).toBe(false)
    expect(viewMovedEnough(base, { ...base, distance: 1040 })).toBe(true)
    expect(viewMovedEnough(base, { ...base, azimuth: 0.04 })).toBe(false)
    expect(viewMovedEnough(base, { ...base, azimuth: 0.06 })).toBe(true)
    expect(viewMovedEnough(base, { ...base, height: 845 })).toBe(true)
  })
})

describe('hysteresis', () => {
  it('keeps a previous pick 10% outside the free rect, not a new one, and drops one 20% outside', () => {
    const sp = space([px('old', 500, 100 - 0.1 * 600), px('new', 500, 100 - 0.1 * 600), px('gone', 400, 100 - 0.2 * 600)])
    // Both at the same spot; only the previous one stays.
    expect(run(sp, query({ ...prev(sp, ['old']) }))).toEqual(['old'])
    expect(run(sp, query({ ...prev(sp, ['gone']) }))).toEqual([])
  })
  it('keeps a previous pick to 1.25 x the reach, not a new one, and drops one past it', () => {
    const everywhere: ToScreen = (_x, _y, _z, out) => {
      out.x = 500
      out.y = 400
      return true
    }
    const d = 1000
    const sp = space([{ id: 'old', at: [1.7 * d, 0] }, { id: 'new', at: [0, 1.7 * d] }, { id: 'gone', at: [-1.9 * d, 0] }])
    expect(run(sp, query({ distance: d, toScreen: everywhere, ...prev(sp, ['old', 'gone']) }))).toEqual(['old'])
  })
  it('keeps a previous fourth against a slightly nearer newcomer, not a clearly nearer one', () => {
    const base = [px('a', 500, 400), px('b', 520, 400), px('c', 540, 400), px('old', 700, 400)]
    const slight = space([...base, px('new', 690, 400)])
    expect(run(slight, query({ ...prev(slight, ['a', 'b', 'c', 'old']) }))).toContain('old')
    const clear = space([...base, px('new', 560, 400)])
    expect(run(clear, query({ ...prev(clear, ['a', 'b', 'c', 'old']) }))).not.toContain('old')
  })
})

describe('purity', () => {
  it('gives the same answer twice and keeps nothing from a call that had a previous', () => {
    const sp = space([px('old', 500, 100 - 60), px('a', 500, 400)])
    const s = newViewScratch(sp)
    const out = new Int32Array(MAX_VIEW_STATIONS)
    const q = query({ ...prev(sp, ['old']) })
    const n1 = chooseViewStations(sp, q, s, out)
    const first = Array.from(out.subarray(0, n1))
    expect(chooseViewStations(sp, q, s, out)).toBe(n1)
    expect(Array.from(out.subarray(0, n1))).toEqual(first)
    const n3 = chooseViewStations(sp, query({ previousCount: 0 }), s, out)
    expect(Array.from(out.subarray(0, n3), (i) => sp.ids[i])).toEqual(['a'])
  })
})

describe('sameMembers', () => {
  const a = Int32Array.of(1, 2, 3)
  it('ignores the order of the tail', () => expect(sameMembers(a, 3, Int32Array.of(1, 3, 2), 3)).toBe(true))
  it('needs the same first slot', () => expect(sameMembers(a, 3, Int32Array.of(2, 1, 3), 3)).toBe(false))
  it('ignores the first slot when it carries no focus', () => expect(sameMembers(a, 3, Int32Array.of(2, 1, 3), 3, false)).toBe(true))
  it('needs the same count and members', () => {
    expect(sameMembers(a, 3, Int32Array.of(1, 2), 2)).toBe(false)
    expect(sameMembers(a, 3, Int32Array.of(1, 2, 4), 3)).toBe(false)
  })
})

describe('viewStationSpace', () => {
  it('holds one entry per group, every member in CSR order, and maps leads', () => {
    const sp = space([{ id: 'A', at: [1, 2] }, { id: 'B', members: [[3, 4], [5, 6], [7, 8]] }])
    expect(sp.ids).toEqual(['A', 'B'])
    expect(Array.from(sp.start)).toEqual([0, 1, 4])
    expect(Array.from(sp.x)).toEqual([1, 3, 5, 7])
    expect(Array.from(sp.z)).toEqual([2, 4, 6, 8])
    expect(sp.indexOf.get('B')).toBe(1)
  })
})

describe('real camera', () => {
  const cases: [string, number, number, ScreenRect][] = [
    ['phone, panel open', 390, 844, interiorFreeRect({ width: 390, height: 844 }, { top: 60, bottom: 24 }, { left: 0, top: 410, right: 390, bottom: 844 })],
    ['ultrawide, side panel', 2560, 1080, interiorFreeRect({ width: 2560, height: 1080 }, { top: 60, bottom: 24 }, { left: 2160, top: 60, right: 2560, bottom: 1056 })],
    ['desktop, side panel', 1440, 900, interiorFreeRect({ width: 1440, height: 900 }, { top: 60, bottom: 24 }, { left: 1040, top: 60, right: 1440, bottom: 876 })],
  ]
  it.each(cases)('every free-rect corner lands within the reach (%s)', (_name, w, h, free) => {
    const cam = new PerspectiveCamera(35, w / h, 10, 1e6)
    const d = LANDING_DISTANCE
    cam.position.set(0, d * Math.cos(ISO_POLAR), d * Math.sin(ISO_POLAR))
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    for (const [sx, sy] of [[free.left, free.top], [free.right, free.top], [free.left, free.bottom], [free.right, free.bottom]] as const) {
      const ray = new Vector3((sx / w) * 2 - 1, 1 - (sy / h) * 2, 0.5).unproject(cam).sub(cam.position).normalize()
      expect(ray.y).toBeLessThan(0)
      const t = -cam.position.y / ray.y
      const hit = cam.position.clone().addScaledVector(ray, t)
      expect(Math.hypot(hit.x, hit.z)).toBeLessThanOrEqual(REACH_SHARE * d)
    }
  })
  it('chooses a station under the camera target', () => {
    const sp = space([{ id: 'A', at: [0, 0] }])
    const cam = new PerspectiveCamera(35, 1440 / 900, 10, 1e6)
    cam.position.set(0, 800 * Math.cos(ISO_POLAR), 800 * Math.sin(ISO_POLAR))
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    const v = new Vector3()
    const toScreen: ToScreen = (x, y, z, out: ScreenPoint) => {
      v.set(x, y, z).project(cam)
      if (v.z < -1 || v.z > 1) return false
      out.x = ((v.x + 1) / 2) * 1440
      out.y = ((1 - v.y) / 2) * 900
      return true
    }
    expect(run(sp, query({ toScreen, free: { left: 0, top: 60, right: 1440, bottom: 876 } }))).toEqual(['A'])
  })
})
