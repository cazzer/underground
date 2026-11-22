import { describe, expect, it } from 'vitest'
import { fixture, ll } from './stationFixture.ts'
import { buildStationInterior } from './stationMerge.ts'

const meta = { version: 1, timestamp: '2026-01-01T00:00:00Z' }
const line = (id: number, pts: [number, number][], tags: Record<string, string> = {}) => ({ id, ...meta, tags, points: pts.map(([u, v]) => ll(u, v)) })

const build = (mutate: (f: ReturnType<typeof fixture>) => void) => {
  const f = fixture()
  f.sources.osm.lines = [line(50, [[-12, 0], [-21, 0]], { highway: 'steps' })]
  const [lat, lon] = ll(-26, 0.5)
  f.sources.osm.nodes = [{ id: 7, ...meta, tags: { highway: 'elevator' }, lat, lon }]
  mutate(f)
  return buildStationInterior(f.authored, f.sources)
}
const connector = (out: ReturnType<typeof build>, id: string) => out.connectors.find((c) => c.id === id)!

describe('connector osmRef', () => {
  it('writes the ref and adds osm to the sources when an end lies on the pinned line', () => {
    const out = build((f) => { f.authored.connectors[1]!.osmRef = 'way/50' })
    expect(connector(out, 'st-plat').osmRef).toBe('way/50')
    expect(connector(out, 'st-plat').sources).toEqual(['authored', 'osm'])
    expect(connector(out, 'st-street').osmRef).toBeUndefined()
    expect(out.attribution).toContain('© OpenStreetMap contributors')
  })
  it('measures an open way to its nearest vertex, so a mid-segment end fails', () => {
    expect(() => build((f) => {
      f.sources.osm.lines = [line(50, [[-30, 0.8], [-12, 0.8]])]
      f.authored.connectors[1]!.osmRef = 'way/50'
    })).not.toThrow()
    expect(() => build((f) => {
      f.sources.osm.lines = [line(50, [[-30, 0], [0, 0]])]
      f.authored.connectors[1]!.osmRef = 'way/50'
    })).toThrow(/no end is within 1 m of way\/50 \(nearest 9\.\d\d m\)/)
  })
  it('accepts a pinned platform way as an area', () => {
    expect(connector(build((f) => { f.authored.connectors[1]!.osmRef = 'way/1' }), 'st-plat').osmRef).toBe('way/1')
  })
  it('rejects an unknown element and a malformed ref', () => {
    expect(() => build((f) => { f.authored.connectors[1]!.osmRef = 'way/99' })).toThrow(/connectors\[1\]\.osmRef: OSM way 99 is not in the pinned sources/)
    expect(() => build((f) => { f.authored.connectors[1]!.osmRef = 'node/99' })).toThrow(/OSM node 99 is not in the pinned sources/)
    expect(() => build((f) => { f.authored.connectors[1]!.osmRef = 'steps/50' })).toThrow(/expected "way\/<id>" or "node\/<id>"/)
    expect(() => build((f) => { f.authored.connectors[1]!.osmRef = 'node/50' })).toThrow(/OSM node 50 is not in the pinned sources/)
  })
  it('rejects a connector with no end within 1 m of the element', () => {
    expect(() => build((f) => { f.sources.osm.lines = [line(50, [[-12, 3.5], [-21, 3.5]])]; f.authored.connectors[1]!.osmRef = 'way/50' }))
      .toThrow(/connectors\[1\]\.osmRef: no end is within 1 m of way\/50 \(nearest 3\.\d\d m\)/)
  })
  it('does not count an entrance end', () => {
    expect(() => build((f) => {
      f.sources.osm.lines = [line(50, [[-12, -14], [-12, -15]])]
      f.authored.connectors[0]!.osmRef = 'way/50'
    })).toThrow(/connectors\[0\]\.osmRef: no end is within 1 m/)
  })
})

describe('machine osmRef', () => {
  it('writes a node ref for a machine whose `at` is on the node', () => {
    const out = build((f) => { f.authored.equipment[1] = { code: 'EL2', at: [-26, 0], osmRef: 'node/7' } })
    expect(connector(out, 'EL2').osmRef).toBe('node/7')
    expect(connector(out, 'EL2').sources).toEqual(['authored', 'nyopendata', 'osm'])
  })
  it('rejects an `at` more than 1 m from the node, and a machine with no authored position', () => {
    expect(() => build((f) => { f.authored.equipment[1] = { code: 'EL2', at: [-26, 2], osmRef: 'node/7' } })).toThrow(/equipment\[1\]\.osmRef: no end is within 1 m of node\/7/)
    expect(() => build((f) => { f.authored.equipment[0] = { code: 'EL1', entrance: 'elev-ent', osmRef: 'node/7' } })).toThrow(/equipment\[0\]\.osmRef: node\/7 needs an authored "at" end/)
  })
  it("checks an escalator's own run", () => {
    const out = build((f) => {
      f.authored.equipment.push({ code: 'ES1', ends: { lower: [-12, 0], upper: [-21, 0] }, osmRef: 'way/50' })
    })
    expect(connector(out, 'ES1').osmRef).toBe('way/50')
  })
})
