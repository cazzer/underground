import { describe, expect, it } from 'vitest'
import { trimEnvelopes } from './catalogEnvelopes.ts'

const feature = (props: Record<string, unknown>, ring: [number, number][], type = 'Polygon') => ({
  type: 'Feature', properties: props, geometry: { type, coordinates: [ring] },
})
const props = (over: Record<string, unknown> = {}) => ({ shape_id: '101', station_name: 'Bedford Av', agency: 'NYCT', division: 'BMT', borough: 'Brooklyn', ...over })

// A 100 m by 100 m square (about 0.0009 degrees of latitude).
const square: [number, number][] = [[-74, 40.7], [-74, 40.7009], [-73.9989, 40.7009], [-73.9989, 40.7], [-74, 40.7]]

describe('trimEnvelopes', () => {
  it('keeps NYCT and NYCT/PATH, drops other agencies, and sorts by numeric shapeId', () => {
    const out = trimEnvelopes({
      features: [
        feature(props({ shape_id: '20', agency: 'Metro-North Railroad' }), square),
        feature(props({ shape_id: '100' }), square),
        feature(props({ shape_id: '9', agency: 'NYCT/PATH' }), square),
      ],
    })
    expect(out.map((e) => [e.shapeId, e.agency])).toEqual([['9', 'NYCT/PATH'], ['100', 'NYCT']])
  })
  it('swaps to [lat, lon], rounds to 6 decimals and keeps the ring closed', () => {
    const [env] = trimEnvelopes({ features: [feature(props(), [[-74.00000049, 40.70000051], [-74, 40.7009], [-73.9989, 40.7009], [-73.9989, 40.7], [-74.00000049, 40.70000051]])] })
    expect(env!.rings[0]![0]).toEqual([40.700001, -74])
    expect(env!.rings[0]![0]).toEqual(env!.rings[0]![env!.rings[0]!.length - 1])
    expect(env).toMatchObject({ shapeId: '101', name: 'Bedford Av', division: 'BMT', borough: 'Brooklyn' })
  })
  it('simplifies a dense arc but keeps the corners', () => {
    // A quarter circle of 200 points (radius about 50 m) between two straight sides.
    const arc: [number, number][] = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 199) * (Math.PI / 2)
      return [-74 + (Math.sin(a) * 0.0006), 40.7 + (1 - Math.cos(a)) * 0.00045]
    })
    const ring: [number, number][] = [[-74, 40.7], ...arc, [-74 + 0.0006, 40.7 + 0.001], [-74, 40.7 + 0.001], [-74, 40.7]]
    const [env] = trimEnvelopes({ features: [feature(props(), ring)] })
    const out = env!.rings[0]!
    expect(out.length).toBeLessThan(60)
    expect(out.length).toBeGreaterThan(8)
    expect(out).toContainEqual([40.701, -74])
    expect(out[0]).toEqual(out[out.length - 1])
  })
  it('throws on a non-Polygon geometry and an unclosed ring, naming the feature', () => {
    expect(() => trimEnvelopes({ features: [feature(props(), square, 'MultiPolygon')] })).toThrow(/features\[0\]\.geometry\.type.*Polygon/)
    expect(() => trimEnvelopes({ features: [feature(props(), square.slice(0, 4))] })).toThrow(/features\[0\]\.geometry\.coordinates\[0\].*closed/)
  })
  it('does not throw on a non-Polygon feature of another agency', () => {
    expect(trimEnvelopes({ features: [feature(props({ agency: 'PATH' }), square, 'MultiPolygon')] })).toEqual([])
  })
})
