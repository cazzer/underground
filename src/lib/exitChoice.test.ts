import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeStationWalk } from '../data/loadStationWalk'
import type { Connector, StationIndex, StationInterior } from '../data/stationSchema'
import type { StationStreets, StreetEntrance } from '../data/streetSchema'
import type { StationWalk } from '../data/walkSchema'
import { chooseExit, quickestExit, streetEntranceIndex, streetJoinOf, walkMinutes, WALK_DETOUR, type ExitChoice, type ExitWalk } from './exitChoice'
import { fixture } from './interiorFixture'
import { toGround } from './projection'
import { FIXTURE_ANCHOR, walkGraph } from './walkFixture'
import { WALK_SPEED_MPS } from './walkRoute'

const W = WALK_SPEED_MPS
const sources: Connector['sources'] = ['authored']
const origin = toGround(FIXTURE_ANCHOR)
const scene = (x: number, z: number) => ({ x: origin.x + x, z: origin.z + z })

const PS1: Connector = { id: 'PS1', kind: 'stair', lower: { x: -10, z: 2, level: 'plat' }, upper: { x: -10, z: 8, level: 'mezz' }, width: 2, sources }
const ST1: Connector = { id: 'ST1', kind: 'stair', lower: { x: 0, z: 10, level: 'mezz' }, upper: { x: 7, z: 10, level: 'street' }, width: 2, sources }
// A longer way out, to the west: 11.5 s slower inside than ST1.
const ST3: Connector = { id: 'ST3', kind: 'stair', lower: { x: -15, z: 14, level: 'mezz' }, upper: { x: -30, z: 14, level: 'street' }, width: 2, sources }

/** Two exits off one mezzanine: E1 (9, 10) close to the platform stair, E3 (-30, 14) farther in and out to the west. */
function twoExits(over: Partial<StationInterior> = {}): StationInterior {
  const base = fixture([PS1, ST1, ST3])
  const entrance = { ...base.entrances[0]!, type: 'Stair' }
  return {
    ...base,
    slabs: [{ ...base.slabs[0]!, outline: [[-15, 2], [15, 2], [15, 15], [-15, 15]] }],
    entrances: [
      { ...entrance, id: 'E1', x: 9, z: 10, connectors: ['ST1'] },
      { ...entrance, id: 'E3', x: -30, z: 14, connectors: ['ST3'] },
    ],
    ...over,
  }
}

/** One long sidewalk along z = 20, from x -300 to 300. */
const street = walkGraph([[-300, 20], [300, 20]], [{ nodes: [0, 1] }])

/** A chosen exit, with its walk outside (chooseExit always prices one). */
function exitOf(result: ReturnType<typeof chooseExit>): ExitChoice & { walk: ExitWalk } {
  if (result.kind !== 'exit') throw new Error(`no exit: ${result.reason}`)
  const { walk } = result
  if (walk === null) throw new Error('chooseExit gave no walk')
  return { ...result, walk }
}

describe('chooseExit on a synthetic station', () => {
  const base = { interior: twoExits(), stopId: 'X01N', walk: street }

  it('takes the slower exit when the walk saves more, with the route drawn from the exit to the destination', () => {
    const choice = exitOf(chooseExit({ ...base, destination: scene(-200, 20) }))
    expect(choice.exit.entranceId).toBe('E3')
    expect(choice.connectorIds).toEqual(['PS1', 'ST3'])
    expect(choice.walk.kind).toBe('route')
    if (choice.walk.kind !== 'route') return
    expect(choice.walk.points[0]).toEqual(scene(-30, 14))
    expect(choice.walk.points[choice.walk.points.length - 1]).toEqual(scene(-200, 20))
    expect(choice.walk.meters).toBeCloseTo(6 + 170, 6)
    expect(choice.walk.seconds).toBeCloseTo((6 + 170) / W, 6)
    expect(choice.totalS).toBeCloseTo(choice.inStationS + choice.walk.seconds, 9)
  })

  it('takes the faster exit when the walk saves less', () => {
    const choice = exitOf(chooseExit({ ...base, destination: scene(60, 20) }))
    expect(choice.exit.entranceId).toBe('E1')
    expect(choice.connectorIds).toEqual(['PS1', 'ST1'])
  })

  it('marks a generated interior as probable and a hand-authored one as not', () => {
    const generated = twoExits({ generated: { archetype: 'cut-cover-mezzanine', confidence: 0.9 } })
    expect(exitOf(chooseExit({ ...base, interior: generated, destination: scene(60, 20) })).probable).toBe(true)
    expect(exitOf(chooseExit({ ...base, destination: scene(60, 20) })).probable).toBe(false)
  })

  it('estimates a straight-line walk past the shard radius', () => {
    const choice = exitOf(chooseExit({ ...base, destination: scene(400, 0) }))
    expect(choice.walk.kind).toBe('estimate')
    const straight = Math.hypot(400 - 9, 0 - 10)
    expect(choice.walk.meters).toBeCloseTo(straight, 6)
    expect(choice.walk.seconds).toBeCloseTo((straight * WALK_DETOUR) / W, 6)
    expect(choice.exit.entranceId).toBe('E1')
  })

  it('estimates with no walk graph', () => {
    const choice = exitOf(chooseExit({ ...base, walk: null, destination: scene(-200, 20) }))
    expect(choice.walk.kind).toBe('estimate')
    expect(choice.walk.seconds).toBeCloseTo(choice.walk.meters * WALK_DETOUR / W, 9)
  })

  it('refuses a walk graph from another station', () => {
    const other = { ...street, stationId: 'X99' }
    expect(() => chooseExit({ ...base, walk: other, destination: scene(0, 20) })).toThrow('walk graph is for station X99, but stop X01N is at X01')
  })

  it('says why there is no exit', () => {
    expect(chooseExit({ ...base, stopId: 'X01S', destination: scene(0, 20) })).toEqual({ kind: 'none', reason: 'no-track' })
    expect(chooseExit({ ...base, stepFree: true, destination: scene(0, 20) })).toEqual({ kind: 'none', reason: 'no-exit' })
    expect(chooseExit({ ...base, closed: new Set(['PS1']), destination: scene(0, 20) })).toEqual({ kind: 'none', reason: 'no-exit' })
  })
})

describe('streetJoinOf', () => {
  const entrance: StreetEntrance = {
    x: 90, z: 100, type: 'Stair', entry: true, exit: true, stopIds: ['X01N'],
    street: 'Bedford Avenue', wayId: 5, cross: null, crossWayId: null, side: 'north', plaza: null,
  }
  const streets = { stationId: 'X01', anchor: FIXTURE_ANCHOR, entrances: [entrance] } as unknown as StationStreets

  it('matches an entrance within 1.5 m of the same type and gives its street fields only', () => {
    expect(streetJoinOf(scene(9, 10), 'Stair', streets)).toEqual({
      street: 'Bedford Avenue', wayId: 5, cross: null, crossWayId: null, side: 'north', plaza: null,
    })
    expect(streetJoinOf(scene(10, 10), 'Stair', streets)?.street).toBe('Bedford Avenue')
  })
  it('gives the matched entrance index', () => {
    expect(streetEntranceIndex(scene(9, 10), 'Stair', streets)).toBe(0)
    expect(streetEntranceIndex(scene(11, 10), 'Stair', streets)).toBeNull()
  })
  it('does not match another type, 2 m away, or an unlisted exit', () => {
    expect(streetJoinOf(scene(9, 10), 'Elevator', streets)).toBeNull()
    expect(streetJoinOf(scene(11, 10), 'Stair', streets)).toBeNull()
    expect(streetJoinOf(scene(9, 10), null, streets)).toBeNull()
  })
})

describe('quickestExit', () => {
  const interior = twoExits()

  it('takes the exit with the least time inside, with no walk or destination', () => {
    const r = quickestExit({ interior, stopId: 'X01N' })
    if (r.kind !== 'exit') throw new Error(r.reason)
    expect(r.exit.entranceId).toBe('E1')
    expect(r.connectorIds).toEqual(['PS1', 'ST1'])
    expect(r.walk).toBeNull()
    expect(r.destination).toBeNull()
    expect(r.totalS).toBe(r.inStationS)
    expect(r.probable).toBe(false)
  })

  it('marks a generated interior probable and avoids a closed way out', () => {
    const generated = twoExits({ generated: { archetype: 'cut-cover-mezzanine', confidence: 0.9 } })
    const g = quickestExit({ interior: generated, stopId: 'X01N' })
    expect(g.kind === 'exit' && g.probable).toBe(true)
    const r = quickestExit({ interior, stopId: 'X01N', closed: new Set(['ST1']) })
    expect(r.kind === 'exit' && r.exit.entranceId).toBe('E3')
  })

  it('says why there is no exit', () => {
    expect(quickestExit({ interior, stopId: 'X01S' })).toEqual({ kind: 'none', reason: 'no-track' })
    expect(quickestExit({ interior, stopId: 'X01N', closed: new Set(['PS1']) })).toEqual({ kind: 'none', reason: 'no-exit' })
  })
})

describe('walkMinutes', () => {
  it('rounds up, to at least one', () => {
    expect([1, 60, 61, 0].map(walkMinutes)).toEqual([1, 1, 2, 1])
  })
})

const read = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T

describe('chooseExit at Bedford Av', () => {
  const interior = read<StationInterior>('public/data/stations/L08.json')
  const walk = decodeStationWalk(read<StationWalk>('public/data/walk/L08.json'))
  const streets = read<StationStreets>('public/data/streets/L08.json')
  const at = (x: number, z: number) => ({ x: walk.anchor.x + x, z: walk.anchor.z + z })
  const input = { interior, stopId: 'L08N', walk, streets }

  it.each([
    [200, 100, 'driggs-'],
    [-200, -100, 'bedford-'],
  ])('walking toward walk-local (%d, %d) picks a %s exit', (x, z, prefix) => {
    const choice = exitOf(chooseExit({ ...input, destination: at(x, z) }))
    expect(choice.exit.entranceId).toContain(prefix)
    expect(choice.probable).toBe(false)
    expect(choice.street).not.toBeNull()
    expect(choice.walk.kind).toBe('route')
    if (choice.walk.kind !== 'route') return
    const exit = toGround(interior.anchor)
    expect(choice.walk.points[0]).toEqual({ x: exit.x + choice.exit.point[0], z: exit.z + choice.exit.point[1] })
    expect(choice.walk.points[choice.walk.points.length - 1]).toEqual(at(x, z))
    expect(choice.walk.meters).toBeGreaterThanOrEqual(Math.hypot(at(x, z).x - choice.walk.points[0]!.x, at(x, z).z - choice.walk.points[0]!.z))
  })

  it('goes step-free through the Bedford elevators when the destination is east', () => {
    const choice = exitOf(chooseExit({ ...input, stepFree: true, destination: at(200, 100) }))
    expect(choice.exit.entranceId).toBe('bedford-ne-elevator')
    expect(choice.connectorIds).toEqual(['EL358', 'EL359'])
    expect(choice.stepFree).toBe(true)
  })

  it('has no step-free exit with the elevator closed', () => {
    expect(chooseExit({ ...input, stepFree: true, closed: new Set(['EL358']), destination: at(200, 100) })).toEqual({ kind: 'none', reason: 'no-exit' })
  })

  it('marks a generated interior with a walk shard as probable', () => {
    const index = read<StationIndex>('public/data/stations/index.json')
    const id = Object.entries(index.stations).find(([, e]) => e.provenance === 'generated' && !e.file)![0]
    const generated = read<StationInterior>(`public/data/stations/${id}.json`)
    const shard = decodeStationWalk(read<StationWalk>(`public/data/walk/${id}.json`))
    const stopId = generated.platforms[0]!.tracks[0]!.stopId
    const choice = exitOf(chooseExit({ interior: generated, stopId, walk: shard, destination: { x: shard.anchor.x + 40, z: shard.anchor.z + 40 } }))
    expect(choice.probable).toBe(true)
    expect(choice.walk.kind).toBe('route')
  })
})
