import { describe, expect, it } from 'vitest'
import { toStableJson } from './stableJson.ts'
import { fixture, ll } from './stationFixture.ts'
import { ELEVATOR_WIDTH_M, ESCALATOR_WIDTH_M } from './stationEquipment.ts'
import { buildStationInterior } from './stationMerge.ts'

const build = (mutate: (f: ReturnType<typeof fixture>) => void = () => {}) => {
  const f = fixture()
  mutate(f)
  return buildStationInterior(f.authored, f.sources)
}
const connector = (out: ReturnType<typeof build>, id: string) => out.connectors.find((c) => c.id === id)!
const decimals = (n: number) => (String(n).split('.')[1] ?? '').length

describe('levels', () => {
  it('sorts by y, highest first', () => {
    expect(build().levels.map((l) => l.id)).toEqual(['street', 'mezz', 'platform'])
  })
  it('requires one street level at y = 0 and unique ids', () => {
    expect(() => build((f) => { f.authored.levels.splice(1, 1) })).toThrow(/exactly one street level, got 0/)
    expect(() => build((f) => { f.authored.levels[1]!.y = 0.5 })).toThrow(/street level must have y = 0/)
    expect(() => build((f) => { f.authored.levels[0]!.id = 'street' })).toThrow(/duplicate level id street/)
  })
  it('reports the JSON path of a bad field', () => {
    expect(() => build((f) => { (f.authored.levels[0] as { y: unknown }).y = 'deep' })).toThrow(/levels\[0\]\.y/)
  })
})

describe('platforms', () => {
  it('projects the OSM ring without the closing point', () => {
    const p = build().platforms[0]!
    expect(p.outline).toHaveLength(4)
    expect(p.outline[0]![0]).toBeCloseTo(-30, 1)
    expect(p.outline[0]![1]).toBeCloseTo(-3, 1)
    expect(p.osmRef).toBe('way/1')
    expect(p.sources).toEqual(['authored', 'osm'])
  })
  it('names a missing OSM way and rejects a foreign stop id', () => {
    expect(() => build((f) => { f.sources.osm.ways = [] })).toThrow(/way 1 is not in the pinned sources/)
    expect(() => build((f) => { f.authored.platforms[0]!.tracks[0]!.stopId = 'X99N' })).toThrow(/X99N/)
  })
})

describe('entrances', () => {
  it('matches rows by exact lat/lon and carries type, flags and local meters', () => {
    const e = build().entrances.find((x) => x.id === 'elev-ent')!
    expect(e).toMatchObject({ type: 'Elevator', entry: true, exit: false, sources: ['nyopendata'] })
    expect(e.x).toBeCloseTo(-25, 1)
    expect(e.z).toBeCloseTo(-14, 1)
  })
  it('throws listing an unmapped row', () => {
    const [lat, lon] = ll(5, 5)
    expect(() => build((f) => { f.sources.entrances.rows.push({ type: 'Stair', entry: true, exit: true, lat, lon }) })).toThrow(
      new RegExp(`${lat},${lon} \\(Stair\\)`),
    )
  })
  it('throws for a key that matches nothing and for two keys on one row', () => {
    expect(() => build((f) => { f.authored.entrances[0]!.source = [41, -74] })).toThrow(/matches 0 Open Data rows/)
    expect(() => build((f) => { f.authored.entrances[1]!.source = f.authored.entrances[0]!.source })).toThrow(/already claimed by entrance stair-ent/)
  })
})

describe('authored connectors', () => {
  it('an {entrance} upper end takes the entrance point at the street level and links back', () => {
    const out = build()
    const st = connector(out, 'st-street')
    const ent = out.entrances.find((e) => e.id === 'stair-ent')!
    expect(st.upper).toEqual({ x: ent.x, z: ent.z, level: 'street' })
    expect(st.sources).toEqual(['authored', 'nyopendata'])
    expect(ent.connectors).toEqual(['st-street'])
  })
  it('rejects {entrance} as the lower end', () => {
    expect(() => build((f) => { f.authored.connectors[0]!.lower = { entrance: 'stair-ent' } })).toThrow(/only be the upper end/)
  })
  it('rejects a lower end that is not below the upper end, and a non-positive width', () => {
    expect(() => build((f) => { f.authored.connectors[1]!.lower = { level: 'mezz', at: [-12, 0] } })).toThrow(/lower end must be below/)
    expect(() => build((f) => { f.authored.connectors[1]!.width = 0 })).toThrow(/width: must be > 0/)
  })
})

describe('entrance links', () => {
  it('requires every entrance to have a connector', () => {
    expect(() => build((f) => { f.authored.equipment = [{ code: 'EL2', at: [-26, 0] }] })).toThrow(/entrance elev-ent: no connector/)
  })
  it('an Elevator entrance cannot link a stair, but Stair/Escalator can link both', () => {
    expect(() => build((f) => {
      f.authored.connectors[0]!.upper = { entrance: 'elev-ent' }
      f.authored.connectors.push({ id: 'st-extra', kind: 'stair', width: 1.5, lower: { level: 'mezz', at: [-12, -9] }, upper: { entrance: 'stair-ent' } })
    })).toThrow(/is a Elevator but connector st-street is a stair/)
    const out = build((f) => {
      f.sources.entrances.rows[0]!.type = 'Stair/Escalator'
      f.sources.equipment.rows[2]!.serving = 'Main St (NE corner) to mezzanine for downtown service'
      f.authored.equipment = [{ code: 'EL1', entrance: 'elev-ent' }, { code: 'EL2', at: [-26, 0] }, { code: 'ES1', entrance: 'stair-ent', at: [-15, 1] }]
    })
    expect(out.entrances.find((e) => e.id === 'stair-ent')!.connectors).toEqual(['ES1', 'st-street'])
  })
  it('rejects an entrance override on a machine that does not reach the street', () => {
    expect(() => build((f) => { f.authored.equipment.push({ code: 'ES1', entrance: 'stair-ent', at: [-15, 1] }) })).toThrow(/ES1 does not reach the street/)
  })
})

describe('equipment', () => {
  it('orders the ends by elevation and gives an elevator identical x/z at both ends', () => {
    const el1 = connector(build(), 'EL1')
    expect(el1.kind).toBe('elevator')
    expect([el1.lower.level, el1.upper.level]).toEqual(['mezz', 'street'])
    expect([el1.lower.x, el1.lower.z]).toEqual([el1.upper.x, el1.upper.z])
    expect(el1).not.toHaveProperty('travel')
  })
  it('the entrance override puts the machine on the entrance point and links it', () => {
    const out = build()
    const ent = out.entrances.find((e) => e.id === 'elev-ent')!
    expect(connector(out, 'EL1').upper).toMatchObject({ x: ent.x, z: ent.z })
    expect(ent.connectors).toEqual(['EL1'])
    expect(connector(out, 'EL1').sources).toEqual(['nyopendata'])
  })
  it('the at override uses the frame point and adds authored; without it the E&E point is used', () => {
    expect(connector(build(), 'EL2')).toMatchObject({ lower: { x: -26, z: 0 }, sources: ['authored', 'nyopendata'] })
    const raw = build((f) => { f.authored.equipment = [{ code: 'EL1', entrance: 'elev-ent' }] })
    expect(connector(raw, 'EL2').lower.x).toBeCloseTo(-24, 1)
    expect(connector(raw, 'EL2').lower.z).toBeCloseTo(2, 1)
  })
  it('sets escalator travel from a one-way serving text and omits it for "both directions"', () => {
    expect(connector(build(), 'ES1').travel).toBe('up')
    const serve = (text: string) => build((f) => { f.sources.equipment.rows[2]!.serving = text })
    const down = serve('mezzanine to platform for Main St exit')
    expect(connector(down, 'ES1')).toMatchObject({ travel: 'down', lower: { level: 'platform' }, upper: { level: 'mezz' } })
    expect(connector(serve('platform to mezzanine for service in both directions'), 'ES1')).not.toHaveProperty('travel')
  })
  it('applies default widths and honors an override', () => {
    const out = build((f) => { f.authored.equipment[1]!.width = 1.8 })
    expect([connector(out, 'EL1').width, connector(out, 'ES1').width, connector(out, 'EL2').width]).toEqual([ELEVATOR_WIDTH_M, ESCALATOR_WIDTH_M, 1.8])
    expect(() => build((f) => { f.authored.equipment[1]!.width = -1 })).toThrow(/width: must be > 0/)
  })
  it('needs a levels override when two levels share a kind', () => {
    const twoMezz = (f: ReturnType<typeof fixture>) => {
      f.authored.levels.push({ id: 'mezz2', name: 'Upper mezzanine', kind: 'mezzanine', y: -2 })
      f.authored.slabs.push({ id: 'slab2', level: 'mezz2', name: 'Upper', outline: [[-40, -20], [-10, -20], [-10, 10], [-40, 10]] })
    }
    expect(() => build(twoMezz)).toThrow(/2 mezzanine levels; add "levels"/)
    const out = build((f) => {
      twoMezz(f)
      const levels = { lower: 'platform', upper: 'mezz2' }
      f.authored.equipment = [
        { code: 'EL1', entrance: 'elev-ent', levels: { lower: 'mezz2', upper: 'street' } },
        { code: 'EL2', at: [-26, 0], levels },
        { code: 'ES1', levels },
      ]
    })
    expect(connector(out, 'EL1').lower.level).toBe('mezz2')
    expect(connector(out, 'ES1').upper.level).toBe('mezz2')
  })
  it('takes the ends straight from a levels override, so a machine can join two mezzanine-kind levels', () => {
    const out = build((f) => {
      f.authored.levels.push({ id: 'mezz2', name: 'Upper mezzanine', kind: 'mezzanine', y: -2 })
      f.authored.slabs.push({ id: 'slab2', level: 'mezz2', name: 'Upper', outline: [[-40, -20], [-10, -20], [-10, 10], [-40, 10]] })
      f.sources.equipment.rows.push({ code: 'ES2', kind: 'escalator', lat: ll(-20, 0)[0], lon: ll(-20, 0)[1], serving: 'mezzanine to mezzanine for transfer' })
      f.authored.equipment = [
        { code: 'EL1', entrance: 'elev-ent', levels: { lower: 'mezz', upper: 'street' } },
        { code: 'EL2', at: [-26, 0], levels: { lower: 'platform', upper: 'mezz' } },
        { code: 'ES1', levels: { lower: 'platform', upper: 'mezz' } },
        { code: 'ES2', levels: { lower: 'mezz2', upper: 'mezz' } },
      ]
    })
    expect(connector(out, 'ES2')).toMatchObject({ lower: { level: 'mezz' }, upper: { level: 'mezz2' } })
    expect(connector(out, 'ES2')).not.toHaveProperty('travel')
  })
  it('names an unknown level id, an unknown key, and a duplicate override', () => {
    const withOverride = (o: object) => () => build((f) => { f.authored.equipment.push(o as never) })
    expect(() => build((f) => { f.authored.equipment[1] = { code: 'EL2', at: [-26, 0], levels: { lower: 'platform', upper: 'attic' } } })).toThrow(/levels\.upper: unknown level "attic"/)
    expect(() => build((f) => { f.authored.equipment[1] = { code: 'EL2', at: [-26, 0], widht: 2 } as never })).toThrow(/equipment\[1\]: unknown key "widht"/)
    expect(withOverride({ code: 'EL2', at: [-26, 0] })).toThrow(/duplicate override for EL2/)
    expect(withOverride({ code: '' })).toThrow(/equipment\[2\]\.code/)
  })
  it('throws for an override with no E&E row', () => {
    expect(() => build((f) => { f.authored.equipment.push({ code: 'EL9' }) })).toThrow(/no E&E row for "EL9"/)
  })
})

describe('containment', () => {
  it('rejects an endpoint 1 m outside every polygon on its level, naming connector and end', () => {
    expect(() => build((f) => { f.authored.equipment[1] = { code: 'EL2', at: [-31, 0] } })).toThrow(/connector EL2 lower end .* 1\.00 m outside every polygon on level platform/)
  })
  it('accepts 0.3 m outside, and never checks street endpoints', () => {
    expect(() => build((f) => { f.authored.equipment[1] = { code: 'EL2', at: [-30.3, 0] } })).not.toThrow()
    expect(connector(build(), 'EL1').upper.level).toBe('street')
  })
})

describe('pinned source rows', () => {
  it('are validated at the merge boundary', () => {
    expect(() => build((f) => { (f.sources.entrances.rows[0] as { entry: unknown }).entry = 'YES' })).toThrow(/entrances\.rows\[0\]\.entry/)
    expect(() => build((f) => { f.sources.entrances.rows[0]!.type = '' })).toThrow(/entrances\.rows\[0\]\.type/)
    expect(() => build((f) => { (f.sources.equipment.rows[0] as { kind: unknown }).kind = 'lift' })).toThrow(/equipment\.rows\[0\]\.kind/)
  })
})

describe('output', () => {
  it('rejects duplicate ids across collections', () => {
    expect(() => build((f) => { f.authored.slabs[0]!.id = 'island' })).toThrow(/duplicate id island/)
  })
  it('is identical for shuffled source rows', () => {
    const a = toStableJson(build(), 2)
    const b = toStableJson(build((f) => { f.sources.equipment.rows.reverse(); f.sources.entrances.rows.reverse() }), 2)
    expect(b).toBe(a)
  })
  it('marks the file ODbL and derives attribution from the sources present', () => {
    const out = build()
    expect(out.license).toBe('ODbL-1.0')
    expect(out.attribution).toEqual(['© OpenStreetMap contributors', 'Metropolitan Transportation Authority, data.ny.gov'])
  })
  it('keeps every number to 2 decimals or fewer', () => {
    const nums: number[] = []
    JSON.stringify(build(), (_k, v: unknown) => { if (typeof v === 'number') nums.push(v); return v })
    expect(nums.filter((n) => decimals(n) > 2 && !Object.values(build().anchor).includes(n))).toEqual([])
  })
})
