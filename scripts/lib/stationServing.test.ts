import { describe, expect, it } from 'vitest'
import { fixture } from './stationFixture.ts'
import { buildStationInterior } from './stationMerge.ts'
import { parseServing, parseServingLenient } from './stationSources.ts'

/** ES1 is on the fixture's E&E rows (platform to mezzanine) and has no override by default. */
const build = (serving: string | null, levels: boolean) => {
  const f = fixture()
  f.sources.equipment.rows[2]!.serving = serving
  if (levels) f.authored.equipment.push({ code: 'ES1', levels: { lower: 'platform', upper: 'mezz' } })
  return buildStationInterior(f.authored, f.sources).connectors.find((c) => c.id === 'ES1')!
}

describe('E&E rows with a null serving text', () => {
  it('fail without a levels override, naming the machine', () => {
    expect(() => build(null, false)).toThrow(/equipment ES1: the E&E row has no serving text; add "levels"/)
  })
  it('are accepted with one, with no direction of travel', () => {
    const es = build(null, true)
    expect([es.lower.level, es.upper.level]).toEqual(['platform', 'mezz'])
    expect(es.travel).toBeUndefined()
  })
  it('fail the same way for a machine that has an override but no levels', () => {
    const f = fixture()
    f.sources.equipment.rows[2]!.serving = null
    f.authored.equipment.push({ code: 'ES1', width: 1.5 })
    expect(() => buildStationInterior(f.authored, f.sources)).toThrow(/equipment\[2\]: the E&E row has no serving text; add "levels"/)
  })
})

describe('serving texts with two " to "', () => {
  const ES219 = 'platform to mezzanine for service to Brooklyn'
  it('stay an error without a levels override', () => {
    expect(() => build(ES219, false)).toThrow(/more than one " to "/)
    expect(() => parseServing(ES219)).toThrow(/more than one " to "/)
  })
  it('are accepted with one, the direction read from the text before " for "', () => {
    expect(build(ES219, true).travel).toBe('up')
    expect(build('mezzanine to platform for service to Brooklyn', true).travel).toBe('down')
  })
  it('give no direction when the cut text still has two " to " or none', () => {
    expect(build('Main St to mezzanine to platform', true).travel).toBeUndefined()
    expect(build('platform to mezzanine to Main St for service', true).travel).toBeUndefined()
    expect(build('no direction here', true).travel).toBeUndefined()
    expect(() => build('no direction here', false)).toThrow(/no " to "/)
  })
  it('a text with one " to " reads as it always did, with levels or without', () => {
    expect(build('platform to mezzanine for Main St exit', true)).toEqual(build('platform to mezzanine for Main St exit', false))
    expect(parseServingLenient('mezzanine to platform for service in both directions')).toEqual({ from: 'mezzanine', to: 'platform', bothDirections: true })
  })
})
