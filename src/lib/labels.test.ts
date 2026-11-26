import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { StationsFile } from '../data/schema'
import { accessLabel, amenityLabel, boroughName, multiBoroughNames, routeChipLabel, routeSpokenName, scheduleLabel, spokenAfterName, updatedLabel } from './labels'
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
})

describe('multiBoroughNames', () => {
  it('collects names whose stations span more than one borough, not names shared within one', () => {
    const names = multiBoroughNames([
      { name: '86 St', borough: 'M' },
      { name: '145 St', borough: 'M' },
      { name: '86 St', borough: 'Bk' },
      { name: '145 St', borough: 'M' },
      { name: 'Bedford Av', borough: 'Bk' },
    ])
    expect([...names]).toEqual(['86 St'])
  })

  it('ignores stations without a borough (an older cached file)', () => {
    expect(multiBoroughNames([{ name: '86 St', borough: 'M' }, { name: '86 St' }]).size).toBe(0)
  })

  it('finds the multi-borough names in the shipped stations, and every partly accessible one has a note', () => {
    const file = JSON.parse(readFileSync('public/data/stations.json', 'utf8')) as StationsFile
    const shared = multiBoroughNames(file.stations)
    expect(shared.has('86 St')).toBe(true)
    expect(shared.has('Prospect Av')).toBe(true)
    expect(shared.has('145 St')).toBe(false)
    expect(shared.has('Bedford Av')).toBe(false)
    const partial = file.stations.filter((s) => s.ada === 'partial')
    expect(partial.length).toBeGreaterThan(0)
    for (const s of partial) expect(accessLabel(stationAccess(s)), s.id).toMatch(/^Partly accessible: \S/)
  })
})

describe('updatedLabel', () => {
  it('formats the update time in New York time', () => {
    // 2026-11-21 19:41:00 UTC is 2:41 PM in New York (EST).
    expect(updatedLabel(Date.UTC(2026, 10, 21, 19, 41) / 1000)).toBe('updated 2:41 PM')
  })
})

describe('amenityLabel', () => {
  it('says nothing for a station with none', () => {
    expect(amenityLabel([])).toBeNull()
    expect(amenityLabel([], 'Enter at 14 St and 4 Av')).toBeNull()
  })

  it('names each amenity, a restroom only as listed', () => {
    expect(amenityLabel(['restroom'])).toBe('Restroom listed by the MTA')
    expect(amenityLabel(['csc'])).toBe('Customer service center, staffed 24/7')
    expect(amenityLabel(['restroom', 'csc'])).toBe('Restroom listed by the MTA; customer service center, staffed 24/7')
  })

  it("adds the customer service center's entrance in the MTA's words", () => {
    expect(amenityLabel(['csc'], 'Enter at 95 St and Broadway')).toBe('Customer service center, staffed 24/7, enter at 95 St and Broadway')
    expect(amenityLabel(['restroom', 'csc'], 'Enter at 42 St and Park Av')).toBe(
      'Restroom listed by the MTA; customer service center, staffed 24/7, enter at 42 St and Park Av',
    )
    expect(amenityLabel(['restroom'], 'Enter at 42 St and Park Av')).toBe('Restroom listed by the MTA')
  })
})

describe('spokenAfterName', () => {
  it('is empty with no access label and no amenities', () => {
    expect(spokenAfterName(null, false, null)).toBe('')
  })

  it('says the access label, then the amenities, as sentences', () => {
    expect(spokenAfterName('Accessible station', false, null)).toBe(', Accessible station.')
    expect(spokenAfterName('Accessible station', true, null)).toBe(', Accessible station; no step-free access now.')
    expect(spokenAfterName('Accessible station', false, 'Restroom listed by the MTA')).toBe(', Accessible station. Restroom listed by the MTA.')
    expect(spokenAfterName(null, false, 'Restroom listed by the MTA')).toBe('. Restroom listed by the MTA.')
  })
})
