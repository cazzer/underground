/** The terminals the committed shapes and stations give, for the words the service-change panel uses. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeShapePoints } from '../../data/codec'
import type { ShapesFile } from '../../data/schema'
import { toGround } from '../projection'
import { realStations } from '../realGroups.testdata'
import { terminalsOf } from './routeTerminals'

const shapes = (JSON.parse(readFileSync('public/data/shapes.json', 'utf8')) as ShapesFile).shapes.map((s) => ({
  routeId: s.routeId,
  direction: s.direction,
  primary: s.primary,
  points: decodeShapePoints(s).map((p) => toGround(p)),
}))
const terminalOf = terminalsOf(shapes, realStations)

describe('terminalsOf on the committed data', () => {
  it('names where the lines go', () => {
    expect(terminalOf('7', 'N')).toBe('Flushing')
    expect(terminalOf('7', 'S')).toBe('Hudson Yards')
    expect(terminalOf('L', 'N')).toBe('8 Av')
    expect(terminalOf('L', 'S')).toBe('Canarsie')
    expect(terminalOf('1', 'N')).toBe('Van Cortlandt Park')
    expect(terminalOf('1', 'S')).toBe('South Ferry')
    expect(terminalOf('F', 'S')).toBe('Coney Island')
  })

  it('finds a terminal for the S shuttles and every route direction that has a primary shape', () => {
    expect(terminalOf('GS', 'N')).not.toBeNull()
    for (const s of shapes.filter((x) => x.primary)) expect(terminalOf(s.routeId, s.direction), `${s.routeId} ${s.direction}`).not.toBeNull()
  })
})
