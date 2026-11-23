import { describe, expect, it } from 'vitest'
import type { Station } from '../network'
import { terminalLabel, terminalsOf, type TerminalShape } from './routeTerminals'

describe('terminalLabel', () => {
  it('takes the first part of a hyphenated name, and the place after a street number', () => {
    expect(terminalLabel('Flushing-Main St')).toBe('Flushing')
    expect(terminalLabel('Van Cortlandt Park-242 St')).toBe('Van Cortlandt Park')
    expect(terminalLabel('34 St-Hudson Yards')).toBe('Hudson Yards')
    expect(terminalLabel('8 Av')).toBe('8 Av')
    expect(terminalLabel('Coney Island-Stillwell Av')).toBe('Coney Island')
    expect(terminalLabel('4 Av-9 St')).toBe('4 Av')
  })
})

const station = (id: string, name: string, x: number, routeIds: string[]): Station => ({
  id,
  name,
  pos: { x, z: 0 },
  routeIds,
  stops: [],
  access: { status: 'none' },
  leadId: id,
})
const shape = (routeId: string, direction: 'N' | 'S', ...pts: [number, number][]): TerminalShape => ({
  routeId,
  direction,
  primary: false,
  points: pts.map(([x, z]) => ({ x, z })),
})

describe('terminalsOf', () => {
  // A trunk along z = 0 from x = 0 to 1000, then two branches: east to Beta (2000, 0) and north to Gamma (1000, 1500).
  // Short turns end at Mid (500, 0), on the trunk.
  const stations = [
    station('t', 'Trunk', 200, ['X']),
    station('m', 'Mid-Main St', 500, ['X']),
    station('j', 'Junction', 1000, ['X']),
    station('b', 'Beta-Last St', 2000, ['X']),
    station('g', 'Gamma', 1000, ['X']),
    station('e', 'East Only', 1500, ['X']),
  ]
  stations[4] = { ...stations[4]!, pos: { x: 1000, z: 1500 } }
  const shapes = [
    shape('X', 'N', [0, 0], [1000, 0], [2000, 0]),
    shape('X', 'N', [0, 0], [1000, 0], [1000, 1500]),
    shape('X', 'N', [0, 0], [500, 0]),
    shape('X', 'S', [2000, 0], [0, 0]),
  ]
  const terminalOf = terminalsOf(shapes, stations)

  it('is the end of the only branch that passes the station', () => {
    expect(terminalOf('X', 'N', ['e'])).toBe('Beta')
    expect(terminalOf('X', 'S', ['t'])).toBe('Trunk')
  })

  it('drops a short turn: its end lies on another path before that path ends', () => {
    // At the trunk the short turn to Mid also passes, but Mid is on the way to the other ends; the two branches remain.
    expect(terminalOf('X', 'N', ['t'])).toBeNull()
    expect(terminalsOf([shapes[0]!, shapes[2]!], stations)('X', 'N', ['t'])).toBe('Beta')
  })

  it('is null where the branches part, and for a station no shape passes, a route or a direction with no shape', () => {
    expect(terminalOf('X', 'N', ['j'])).toBeNull()
    expect(terminalOf('X', 'N', ['nowhere'])).toBeNull()
    expect(terminalOf('Y', 'N', ['t'])).toBeNull()
  })

  it('reads a complex by any member and asks of every member in one key', () => {
    expect(terminalOf('X', 'N', ['nowhere', 'e'])).toBe('Beta')
  })
})
