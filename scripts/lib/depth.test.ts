import { describe, expect, it } from 'vitest'
import { parseOsmLevel, stationDepths } from './depth.ts'
import type { DepthInput } from './depth.ts'
import type { EquipmentFact } from './stationFacts.ts'

const eq = (code: string, serving: string, rise: string | null): EquipmentFact => ({ code, kind: 'elevator', serving, rise, at: [0, 0] })
const base: DepthInput = { stationId: 'T01', structure: 'subway', hasMezzanine: true, platformLevel: null, equipment: [] }

describe('parseOsmLevel', () => {
  it('reads one number and nothing else', () => {
    expect(parseOsmLevel('-2')).toBe(-2)
    expect(parseOsmLevel(' 1 ')).toBe(1)
    expect(parseOsmLevel('-1;-2')).toBeNull()
    expect(parseOsmLevel('')).toBeNull()
    expect(parseOsmLevel('B')).toBeNull()
    expect(parseOsmLevel(null)).toBeNull()
  })
})

describe('stationDepths', () => {
  it('uses the structure default when nothing else is known', () => {
    const d = stationDepths(base)
    expect(d.platform).toEqual({ y: -9, source: 'structure-default' })
    expect(d.mezzanine).toEqual({ y: -4.5, source: 'structure-default' })
    expect(stationDepths({ ...base, hasMezzanine: false }).platform.y).toBe(-5)
    expect(stationDepths({ ...base, structure: 'elevated' })).toMatchObject({ platform: { y: 8 }, mezzanine: { y: 4 } })
    expect(stationDepths({ ...base, structure: 'open-cut', hasMezzanine: false }).platform.y).toBe(-5)
    expect(stationDepths({ ...base, structure: 'at-grade', hasMezzanine: false }).platform.y).toBe(0)
    expect(stationDepths({ ...base, structure: 'embankment', hasMezzanine: false }).platform.y).toBe(4)
  })

  it('reads the OSM level as 4.5 m per level, with the mezzanine one level up', () => {
    const d = stationDepths({ ...base, platformLevel: -2 })
    expect(d.platform).toEqual({ y: -9, source: 'osm-level' })
    expect(d.mezzanine).toEqual({ y: -4.5, source: 'osm-level' })
    expect(stationDepths({ ...base, structure: 'elevated', platformLevel: 2 })).toMatchObject({ platform: { y: 9 }, mezzanine: { y: 4.5 } })
  })

  it('ignores an OSM level on the wrong side of the street, and says so', () => {
    const d = stationDepths({ ...base, platformLevel: 1 })
    expect(d.platform.source).toBe('structure-default')
    expect(d.reasons.join('\n')).toMatch(/OSM level 1 contradicts/)
  })

  it('takes street-to-platform rises from E&E, in the median, ahead of the OSM level', () => {
    const d = stationDepths({
      ...base,
      platformLevel: -2,
      equipment: [
        eq('EL1', 'street to platform for service in both directions', "100' 0in"),
        eq('EL2', 'Main St to platform', "110'"),
        eq('EL3', 'Main St to platform', "105'"),
      ],
    })
    expect(d.platform.source).toBe('ee-rise')
    expect(d.platform.y).toBeCloseTo(-105 * 0.3048, 3)
  })

  it('puts the platform below the E&E mezzanine by the mezzanine-to-platform rise', () => {
    const d = stationDepths({
      ...base,
      equipment: [eq('EL1', 'Main St to mezzanine', "15'"), eq('EL2', 'mezzanine to platform for service in both directions', "20'")],
    })
    expect(d.mezzanine).toEqual({ y: -15 * 0.3048, source: 'ee-rise' })
    expect(d.platform.y).toBeCloseTo(-35 * 0.3048, 3)
    expect(d.platform.source).toBe('ee-rise')
  })

  it('does not build a platform from a mezzanine rise when the mezzanine itself is not measured', () => {
    const d = stationDepths({ ...base, equipment: [eq('EL2', 'mezzanine to platform', "20'")] })
    expect(d.platform.source).toBe('structure-default')
    expect(d.reasons.join('\n')).toMatch(/mezzanine depth is not measured/)
  })

  it('mirrors the sign for an elevated station', () => {
    const d = stationDepths({ ...base, structure: 'elevated', equipment: [eq('EL1', 'street to platform', "30'")] })
    expect(d.platform.y).toBeCloseTo(30 * 0.3048, 3)
  })

  it('reads the landing pair before "and access to" in a serving text with a second destination', () => {
    const d = stationDepths({ ...base, equipment: [eq('EL1', 'Main St (SW corner) to mezzanine for service in both directions and access to passageway to Broadway & Main St', "50' 0in")] })
    expect(d.mezzanine?.source).toBe('ee-rise')
    expect(d.reasons.join('\n')).not.toMatch(/ignored for depth/)
  })

  it('records, by code, a multi-landing serving text and a bad or out-of-range rise instead of throwing', () => {
    const d = stationDepths({
      ...base,
      equipment: [
        eq('EL9', 'street to mezzanine to platform', "100'"),
        eq('EL8', 'street to platform', '100'),
        eq('EL7', 'street to platform', "5000'"),
        eq('EL6', 'street to platform', "0'6in"),
      ],
    })
    const text = d.reasons.join('\n')
    expect(text).toMatch(/EL9: ignored for depth: .*more than one/)
    expect(text).toMatch(/EL8: rise ignored/)
    expect(text).toMatch(/EL7: rise .* outside 1-60 m/)
    expect(text).toMatch(/EL6: rise .* outside 1-60 m/)
    expect(d.platform.source).toBe('structure-default')
  })

  it('falls back to the deep list, below E&E', () => {
    const list = [{ stationId: 'T01', platformY: -30, citation: 'test' }]
    expect(stationDepths(base, list).platform).toEqual({ y: -30, source: 'deep-list' })
    const withEe = stationDepths({ ...base, equipment: [eq('EL1', 'street to platform', "100'")] }, list)
    expect(withEe.platform.source).toBe('ee-rise')
  })

  it('keeps the mezzanine at least 2.5 m nearer the street than the platform', () => {
    const d = stationDepths({ ...base, equipment: [eq('EL1', 'street to mezzanine', "30'"), eq('EL2', 'street to platform', "32'")] })
    expect(d.platform.y).toBeCloseTo(-32 * 0.3048, 3)
    expect(d.mezzanine).toEqual({ y: d.platform.y / 2, source: 'structure-default' })
    expect(d.reasons.join('\n')).toMatch(/not 2.5 m from both the street and the platform/)
  })

  it('keeps the mezzanine off the street level too (OSM level -1 with a mezzanine, elevated level 1)', () => {
    const sub = stationDepths({ ...base, platformLevel: -1 })
    expect(sub.platform.y).toBe(-4.5)
    expect(sub.mezzanine).toEqual({ y: -2.25, source: 'structure-default' })
    expect(sub.reasons.join('\n')).toMatch(/not 2.5 m from both the street/)
    expect(sub.reasons.join('\n')).toMatch(/too shallow to fit a mezzanine .* doubtful: -0.1/)
    expect(sub.penalty).toBe(0.1)
    expect(stationDepths(base).penalty).toBe(0)
    const el = stationDepths({ ...base, structure: 'elevated', platformLevel: 1 })
    expect(el.platform.y).toBe(4.5)
    expect(el.mezzanine).toEqual({ y: 2.25, source: 'structure-default' })
    expect(el.reasons.join('\n')).toMatch(/half the platform height/)
    expect(el.reasons.join('\n')).toMatch(/too low to fit a mezzanine/)
    expect(el.reasons.join('\n')).not.toMatch(/depth|shallow/)
  })

  it('puts an unmeasured platform below a deeper, measured E&E mezzanine (deep stations with long elevators)', () => {
    const d = stationDepths({ ...base, platformLevel: -2, equipment: [eq('EL1', 'street to mezzanine', "172' 9in")] })
    expect(d.mezzanine).toEqual({ y: -172.75 * 0.3048, source: 'ee-rise' })
    expect(d.platform.source).toBe('ee-rise')
    expect(d.platform.y).toBeCloseTo(-172.75 * 0.3048 - 4.5, 3)
    expect(d.reasons.join('\n')).toMatch(/platform set 4.5 m below it/)
  })

  it('moves an elevated platform up, not down, below a higher measured E&E mezzanine', () => {
    const d = stationDepths({ ...base, structure: 'elevated', equipment: [eq('EL1', 'street to mezzanine', "40'")] })
    expect(d.mezzanine?.source).toBe('ee-rise')
    expect(d.mezzanine!.y).toBeCloseTo(40 * 0.3048, 3)
    expect(d.platform.y).toBeCloseTo(40 * 0.3048 + 4.5, 3)
    expect(d.reasons.join('\n')).toMatch(/higher than the structure-default platform 8 m; platform set 4.5 m above it/)
  })

  it('has no mezzanine when the station has none', () => {
    expect(stationDepths({ ...base, hasMezzanine: false, equipment: [eq('EL1', 'street to mezzanine', "20'")] }).mezzanine).toBeNull()
  })
})
