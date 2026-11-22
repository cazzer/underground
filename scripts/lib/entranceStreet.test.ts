import { describe, expect, it } from 'vitest'
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import type { StreetEntrance } from '../../src/data/streetSchema.ts'
import { joinEntrance, streetKey, type JoinWay } from './entranceStreet.ts'

const NO_STREET = { street: null, wayId: null, cross: null, crossWayId: null, side: null, plaza: null }

function way(id: number, name: string | null, points: LocalPoint[], highway = 'residential', closed = false): JoinWay {
  return { id, highway, name, closed, points }
}

/** A street running north-south along x (z grows southward). */
function vertical(id: number, name: string | null, x: number, z0 = -100, z1 = 100, highway = 'residential'): JoinWay {
  return way(id, name, [[x, z0], [x, z1]], highway)
}

/** A street running east-west along z. */
function horizontal(id: number, name: string | null, z: number, x0 = -100, x1 = 100, highway = 'residential'): JoinWay {
  return way(id, name, [[x0, z], [x1, z]], highway)
}

function rotate(p: LocalPoint, degrees: number): LocalPoint {
  const r = (degrees * Math.PI) / 180
  return [p[0] * Math.cos(r) - p[1] * Math.sin(r), p[0] * Math.sin(r) + p[1] * Math.cos(r)]
}

describe('streetKey', () => {
  it('unifies abbreviations, directions and ordinals', () => {
    expect(streetKey('N 7th St')).toBe(streetKey('North 7th Street'))
    expect(streetKey('Fulton Street')).toBe(streetKey('Fulton St.'))
    expect(streetKey('Fulton St')).not.toBe(streetKey('Fulton Av'))
  })
})

describe('joinEntrance', () => {
  it('gives a mid-block entrance its street and side, with no cross street', () => {
    const ways = [vertical(1, 'Main St', 0), horizontal(2, 'Far St', -300)]
    expect(joinEntrance([5, 0], ways)).toEqual({ ...NO_STREET, street: 'Main St', wayId: 1, side: 'east' })
    expect(joinEntrance([-5, 0], ways).side).toBe('west')
  })

  it('gives a corner entrance both streets and the corner', () => {
    const ways = [vertical(1, 'Main St', 0), horizontal(2, 'Cross St', 0)]
    expect(joinEntrance([6, -6], ways)).toEqual({
      street: 'Main St',
      wayId: 1,
      cross: 'Cross St',
      crossWayId: 2,
      side: 'NE',
      plaza: null,
    })
    expect(joinEntrance([-6, 6], ways).side).toBe('SW')
    expect(joinEntrance([6, 6], ways).side).toBe('SE')
    expect(joinEntrance([-6, -6], ways).side).toBe('NW')
  })

  it('does not call a cross street a corner beyond the slack', () => {
    const ways = [vertical(1, 'Main St', 0), horizontal(2, 'Cross St', -20)]
    const join = joinEntrance([3, 0], ways)
    expect(join.street).toBe('Main St')
    expect(join.cross).toBeNull()
    expect(join.side).toBe('east')
  })

  it('finds nothing out of range', () => {
    expect(joinEntrance([100, 0], [vertical(1, 'Main St', 0)])).toEqual(NO_STREET)
  })

  it('does not count a second way of the same name as a corner, even at a bend', () => {
    // An L: the two ways meet at (0,0) at a right angle, so only the name says they are one street.
    const ways = [vertical(1, 'Main St', 0, -100, 0), horizontal(2, 'Main St', 0, 0, 100)]
    expect(joinEntrance([6, -6], ways)).toEqual({ ...NO_STREET, street: 'Main St', wayId: 1, side: 'east' })
  })

  it('treats differently spelled names of one street as one street, even at a bend', () => {
    const ways = [vertical(1, 'N 7th St', 0, -100, 0), horizontal(2, 'North 7th Street', 0, 0, 100)]
    expect(joinEntrance([6, -6], ways)).toEqual({ ...NO_STREET, street: 'N 7th St', wayId: 1, side: 'east' })
  })

  it('puts an entrance between two carriageways in the median, and outside on the near one', () => {
    // The southbound carriageway is drawn reversed, as OSM draws opposite one-ways.
    const ways = [vertical(1, 'Park Av', -10), vertical(2, 'Park Av', 10, 100, -100)]
    expect(joinEntrance([0, 0], ways).side).toBe('median')
    expect(joinEntrance([-14, 0], ways)).toEqual({ ...NO_STREET, street: 'Park Av', wayId: 1, side: 'west' })
    expect(joinEntrance([14, 0], ways)).toEqual({ ...NO_STREET, street: 'Park Av', wayId: 2, side: 'east' })
  })

  it('keeps the cross street of a median entrance at an intersection', () => {
    const ways = [vertical(1, 'Broadway', -10), vertical(2, 'Broadway', 10, 100, -100), horizontal(3, 'W 72nd St', 0)]
    for (const x of [2, -2]) {
      expect(joinEntrance([x, -8], ways)).toMatchObject({
        street: 'Broadway',
        cross: 'W 72nd St',
        crossWayId: 3,
        side: 'median',
      })
    }
  })

  it('does not take the stem of a T-junction or a dead end short of the street as a corner', () => {
    const stem = horizontal(2, 'Cross St', 0, -100, 0)
    expect(joinEntrance([6, -2], [vertical(1, 'Main St', 0), stem])).toEqual({
      ...NO_STREET,
      street: 'Main St',
      wayId: 1,
      side: 'east',
    })
    const deadEnd = horizontal(2, 'Cross St', 0, -100, -9)
    expect(joinEntrance([3, -2], [vertical(1, 'Main St', 0), deadEnd]).cross).toBeNull()
    // The same street still makes a corner on the stem's own side of the junction.
    expect(joinEntrance([-6, -2], [vertical(1, 'Main St', 0), stem])).toMatchObject({
      street: 'Cross St',
      cross: 'Main St',
      side: 'NW',
    })
  })

  it('gives the same side at a bend whichever way the way is drawn', () => {
    const bend: LocalPoint[] = [[0, -100], [0, 0], [100, 0]]
    const forward = joinEntrance([-0.5, 5], [way(1, 'Main St', bend)])
    const reversed = joinEntrance([-0.5, 5], [way(1, 'Main St', [...bend].reverse())])
    expect(forward).toEqual({ ...NO_STREET, street: 'Main St', wayId: 1, side: 'south' })
    expect(reversed).toEqual(forward)
  })

  it('ignores a parallel, differently named service road', () => {
    const ways = [vertical(1, 'Main St', 0), vertical(2, 'Alley Rd', 8, -100, 100, 'service')]
    const join = joinEntrance([-3, 0], ways)
    expect(join).toEqual({ ...NO_STREET, street: 'Main St', wayId: 1, side: 'west' })
  })

  it('never picks a sidewalk over a roadway', () => {
    const ways = [vertical(1, 'Main St', 2, -100, 100, 'footway'), vertical(2, 'Broadway', 9, -100, 100, 'secondary')]
    expect(joinEntrance([0, 0], ways)).toEqual({ ...NO_STREET, street: 'Broadway', wayId: 2, side: 'west' })
  })

  it('ignores unnamed ways and motorways', () => {
    const ways = [
      vertical(1, null, 3),
      vertical(2, 'Expressway', -4, -100, 100, 'motorway'),
      vertical(3, 'Quiet St', 20),
    ]
    expect(joinEntrance([0, 0], ways)).toEqual({ ...NO_STREET, street: 'Quiet St', wayId: 3, side: 'west' })
  })

  it('sets plaza inside a named pedestrian area and never takes the area as the street', () => {
    const ring: LocalPoint[] = [[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]]
    const ways = [way(1, 'Fulton Mall', ring, 'pedestrian', true)]
    expect(joinEntrance([0, 0], ways)).toEqual({ ...NO_STREET, plaza: 'Fulton Mall' })
    expect(joinEntrance([30, 0], ways)).toEqual(NO_STREET)
  })

  it('names the same corner on a grid rotated 30 degrees', () => {
    const ways = [vertical(1, 'Main St', 0), horizontal(2, 'Cross St', 0)].map((w) => ({
      ...w,
      points: w.points.map((p) => rotate(p, 30)),
    }))
    const join = joinEntrance(rotate([7, -5], 30), ways)
    expect(join).toMatchObject({ street: 'Cross St', cross: 'Main St', side: 'NE' })
  })

  it('takes the side from the end segment when the entrance is past the way end', () => {
    const join = joinEntrance([5, -10], [vertical(1, 'Main St', 0, 0, 100)])
    expect(join).toEqual({ ...NO_STREET, street: 'Main St', wayId: 1, side: 'east' })
  })

  it('gives no side within a meter of the centerline', () => {
    expect(joinEntrance([0.5, 0], [vertical(1, 'Main St', 0)])).toEqual({ ...NO_STREET, street: 'Main St', wayId: 1 })
  })

  it('breaks distance ties by lower way id, whatever the input order', () => {
    const ways = [vertical(5, 'Main St', -6), vertical(3, 'Alt St', 6)]
    for (const order of [ways, [...ways].reverse()]) {
      expect(joinEntrance([0, 0], order)).toEqual({ ...NO_STREET, street: 'Alt St', wayId: 3, side: 'west' })
    }
  })

  it('fits a stored entrance', () => {
    const join = joinEntrance([6, -6], [vertical(1, 'Main St', 0), horizontal(2, 'Cross St', 0)])
    const entrance = { x: 60, z: -60, type: 'Stair', entry: true, exit: true, stopIds: ['L08N'], ...join } satisfies StreetEntrance
    expect(entrance.cross).toBe('Cross St')
  })
})
