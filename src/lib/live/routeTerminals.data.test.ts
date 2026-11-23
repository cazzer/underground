/** The terminals the committed shapes and stations give, for the words the service-change panel uses. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeShapePoints } from '../../data/codec'
import type { ShapesFile } from '../../data/schema'
import { toGround } from '../projection'
import { realGroupById, realStations } from '../realGroups.testdata'
import { terminalsOf } from './routeTerminals'

const shapes = (JSON.parse(readFileSync('public/data/shapes.json', 'utf8')) as ShapesFile).shapes.map((s) => ({
  routeId: s.routeId,
  direction: s.direction,
  primary: s.primary,
  points: decodeShapePoints(s).map((p) => toGround(p)),
}))
const terminalOf = terminalsOf(shapes, realStations)
/** The terminal a train of `route` going `d` has at station `id` (a complex: all its members). */
const at = (route: string, d: 'N' | 'S', id: string) => terminalOf(route, d, realGroupById.get(id)!.memberIds)

describe('terminalsOf on the committed data', () => {
  it('names where the lines go', () => {
    expect(at('7', 'N', '713')).toBe('Flushing')
    expect(at('7', 'S', '713')).toBe('Hudson Yards')
    expect(at('L', 'N', 'L08')).toBe('8 Av')
    expect(at('L', 'S', 'L08')).toBe('Canarsie')
    expect(at('1', 'N', '116')).toBe('Van Cortlandt Park')
    expect(at('1', 'S', '116')).toBe('South Ferry')
    expect(at('F', 'S', 'F22')).toBe('Coney Island')
  })

  it('reads the end of the branch the station is on, not the route\'s primary shape', () => {
    // Queens Blvd: the M's northbound trains end at Forest Hills (its primary shape ends elsewhere).
    expect(at('M', 'N', 'G11')).toBe('Forest Hills')
    // Church Av on the Nostrand Av line: the 5 southbound goes to Flatbush Av, not Bowling Green.
    expect(at('5', 'S', '244')).toBe('Flatbush Av')
    // The A's Lefferts branch, and the E's end of line.
    expect(at('A', 'S', 'A63')).toBe('Lefferts Blvd')
    expect(at('E', 'N', 'G06')).toBe('Jamaica Center')
  })

  it('is null where the branches part: Rockaway Blvd on the A, and the shared stretch before it', () => {
    expect(at('A', 'S', 'A61')).toBeNull()
    expect(at('A', 'S', 'A59')).toBeNull()
  })

  it('is null for a station the route does not pass', () => {
    expect(at('L', 'N', '116')).toBeNull()
  })

  it('finds a terminal for the S shuttles and gives a station on every route direction either one end or null', () => {
    expect(at('GS', 'N', '902')).not.toBeNull()
    expect(at('J', 'N', 'M20')).not.toBeNull()
  })
})
