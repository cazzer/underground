import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { StationsFile } from '../data/schema'
import { accessLabel, boroughName, routeChipLabel, routeSpokenName, scheduleLabel, sharedNames } from './labels'
import { stationAccess } from './network'

describe('routeChipLabel', () => {
  it('writes express variants as the base route plus a diamond', () => {
    expect(routeChipLabel('FX')).toBe('F◆')
    expect(routeChipLabel('6X')).toBe('6◆')
    expect(routeChipLabel('7X')).toBe('7◆')
  })

  it('leaves other names alone', () => {
    expect(routeChipLabel('A')).toBe('A')
    expect(routeChipLabel('S')).toBe('S')
    expect(routeChipLabel('SIR')).toBe('SIR')
  })
})

describe('routeSpokenName', () => {
  it('says express variants as the base route plus "express"', () => {
    expect(routeSpokenName('FX')).toBe('F express')
    expect(routeSpokenName('6X')).toBe('6 express')
  })
  it('leaves other names alone', () => {
    expect(routeSpokenName('A')).toBe('A')
    expect(routeSpokenName('SIR')).toBe('SIR')
  })
})

describe('scheduleLabel', () => {
  it('formats the YYYYMMDD prefix of the feed version', () => {
    expect(scheduleLabel('20261028-fall-2026-pick-with-long-term-supplements')).toBe('Schedule: Oct 28, 2026')
    expect(scheduleLabel('20270105')).toBe('Schedule: Jan 5, 2027')
  })

  it('falls back to the raw id when there is no valid date prefix', () => {
    expect(scheduleLabel('fall-2026')).toBe('Schedule: fall-2026')
    expect(scheduleLabel('20261328-x')).toBe('Schedule: 20261328-x')
  })
})

describe('boroughName', () => {
  it('spells out every borough code', () => {
    expect(boroughName('Bx')).toBe('Bronx')
    expect(boroughName('M')).toBe('Manhattan')
    expect(boroughName('Bk')).toBe('Brooklyn')
    expect(boroughName('Q')).toBe('Queens')
    expect(boroughName('SI')).toBe('Staten Island')
  })
})

describe('accessLabel', () => {
  it('labels accessible and partly accessible stations, with the direction note when there is one', () => {
    expect(accessLabel({ status: 'full' })).toBe('Accessible station')
    expect(accessLabel({ status: 'partial', note: 'Downtown only' })).toBe('Partly accessible: Downtown only')
    expect(accessLabel({ status: 'partial' })).toBe('Partly accessible')
  })

  it('gives no label to a station that is not accessible', () => {
    expect(accessLabel({ status: 'none' })).toBeNull()
  })

  it('reads a station from an older file without the fields as not accessible', () => {
    expect(stationAccess({})).toEqual({ status: 'none' })
    expect(stationAccess({ ada: 'full' })).toEqual({ status: 'full' })
    expect(stationAccess({ ada: 'partial', adaPartial: { north: false, south: true, note: 'Uptown only' } })).toEqual({
      status: 'partial',
      note: 'Uptown only',
    })
  })
})

describe('sharedNames', () => {
  it('collects only names used by more than one station', () => {
    const names = sharedNames([{ name: '86 St' }, { name: 'Canal St' }, { name: '86 St' }, { name: 'Bedford Av' }, { name: '86 St' }])
    expect([...names]).toEqual(['86 St'])
  })

  it('finds shared names in the shipped stations, and every partly accessible one has a note', () => {
    const file = JSON.parse(readFileSync('public/data/stations.json', 'utf8')) as StationsFile
    const shared = sharedNames(file.stations)
    expect(shared.has('86 St')).toBe(true)
    expect(shared.has('Bedford Av')).toBe(false)
    const partial = file.stations.filter((s) => s.ada === 'partial')
    expect(partial.length).toBeGreaterThan(0)
    for (const s of partial) expect(accessLabel(stationAccess(s)), s.id).toMatch(/^Partly accessible: \S/)
  })
})
