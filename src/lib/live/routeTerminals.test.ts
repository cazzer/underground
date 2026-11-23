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
const shape = (routeId: string, direction: 'N' | 'S', primary: boolean, ...xs: number[]): TerminalShape => ({ routeId, direction, primary, points: xs.map((x) => ({ x, z: 0 })) })

describe('terminalsOf', () => {
  const stations = [
    station('a', 'Alpha-Main St', 0, ['X']),
    station('b', 'Beta', 1000, ['X', 'Y']),
    station('c', 'Gamma', 1010, ['Y']),
  ]
  const shapes = [shape('X', 'N', true, 0, 500, 990), shape('X', 'S', true, 990, 0), shape('X', 'S', false, 990, 400), shape('Y', 'N', true, 1000, 1008)]
  const terminalOf = terminalsOf(shapes, stations)

  it('is the nearest station the route serves to the end of its primary shape for that direction', () => {
    expect(terminalOf('X', 'N')).toBe('Beta')
    expect(terminalOf('X', 'S')).toBe('Alpha')
    expect(terminalOf('Y', 'N')).toBe('Gamma')
  })

  it('is null for a route or direction with no shape, and ignores stations the route does not serve', () => {
    expect(terminalOf('Y', 'S')).toBeNull()
    expect(terminalOf('Z', 'N')).toBeNull()
    expect(terminalsOf([shape('X', 'N', true, 1012)], stations)('X', 'N')).toBe('Beta')
  })
})
