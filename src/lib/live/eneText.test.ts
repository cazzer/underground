import { describe, expect, it } from 'vitest'
import type { OutageJoin } from './eneJoin'
import { nyReturnLabel, outagePanelView, unknownText } from './eneText'

/** 2026-11-18 (a Wednesday) 12:00 in New York (EST, UTC-5): 17:00 UTC. */
const NOON = Date.UTC(2026, 10, 18, 17, 0) / 1000
/** The same instant, plus New York wall-clock hours (EST). */
const ny = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour + 5, minute) / 1000

describe('nyReturnLabel', () => {
  it('says "about" for later today, dropping :00', () => {
    expect(nyReturnLabel(ny(18, 18), NOON)).toBe('about 6 PM')
    expect(nyReturnLabel(ny(18, 18, 30), NOON)).toBe('about 6:30 PM')
  })

  it('says tomorrow, a weekday within six days, or the date after that', () => {
    expect(nyReturnLabel(ny(19, 6), NOON)).toBe('tomorrow 6 AM')
    expect(nyReturnLabel(ny(20, 6), NOON)).toBe('Fri 6 AM')
    expect(nyReturnLabel(ny(24, 6), NOON)).toBe('Tue 6 AM')
    expect(nyReturnLabel(ny(25, 6), NOON)).toBe('Nov 25')
  })

  it('counts days in New York, not UTC: 11 PM and 1 AM local are different days', () => {
    // 23:30 New York is 04:30 UTC the next day.
    const lateNow = ny(18, 23, 30)
    expect(nyReturnLabel(ny(19, 0, 30), lateNow)).toBe('tomorrow 12:30 AM')
    expect(nyReturnLabel(ny(18, 23, 45), lateNow)).toBe('about 11:45 PM')
  })

  it('follows the clock change: the day after the fall-back weekend is still the next day', () => {
    // 2026-11-01 02:00 EDT falls back to 01:00 EST. Noon Saturday the 31st (EDT, UTC-4) to 6 AM Sunday (EST, UTC-5).
    const saturdayNoon = Date.UTC(2026, 9, 31, 16, 0) / 1000
    const sundayMorning = Date.UTC(2026, 10, 1, 11, 0) / 1000
    expect(nyReturnLabel(sundayMorning, saturdayNoon)).toBe('tomorrow 6 AM')
    // Monday 6 AM, two days out.
    expect(nyReturnLabel(Date.UTC(2026, 10, 2, 11, 0) / 1000, saturdayNoon)).toBe('Mon 6 AM')
  })

  it('is null once the time has passed', () => {
    expect(nyReturnLabel(NOON, NOON)).toBeNull()
    expect(nyReturnLabel(NOON - 1, NOON)).toBeNull()
  })
})

const join = (panel: OutageJoin['panel'], known = true): OutageJoin => ({ panel, outIds: [], known, closed: known ? new Set() : null })

describe('outagePanelView', () => {
  it('is empty for none', () => {
    expect(outagePanelView(join({ kind: 'none' }), NOON)).toEqual({ known: true, noStepFree: false, body: { kind: 'none' } })
  })

  it('writes the rows: title, then levels, code and return time', () => {
    const view = outagePanelView(
      join({
        kind: 'out',
        outages: [
          { id: 'EL358', kind: 'elevator', levels: 'Mezzanine to platform', source: 'interior', returnAt: ny(18, 18) },
          { id: 'ES2', kind: 'escalator', levels: 'Street to mezzanine', source: 'interior', returnAt: NOON - 60 },
          { id: 'ES3', kind: 'escalator', levels: 'Street to mezzanine', source: 'interior', returnAt: null },
        ],
      }),
      NOON,
    )
    expect(view.body).toEqual({
      kind: 'out',
      shown: 2,
      rows: [
        { id: 'EL358', kind: 'elevator', title: 'Elevator out of service', levels: 'Mezzanine to platform', wraps: false, meta: ['EL358', 'back about 6 PM'] },
        { id: 'ES2', kind: 'escalator', title: 'Escalator out of service', levels: 'Street to mezzanine', wraps: false, meta: ['ES2', 'return time passed'] },
        { id: 'ES3', kind: 'escalator', title: 'Escalator out of service', levels: 'Street to mezzanine', wraps: false, meta: ['ES3'] },
      ],
    })
  })

  it('carries noStepFree only with outages', () => {
    const out = join({ kind: 'out', outages: [{ id: 'EL1', kind: 'elevator', levels: 'Street to platform', source: 'interior', returnAt: null }] })
    expect(outagePanelView(out, NOON, true).noStepFree).toBe(true)
    expect(outagePanelView(out, NOON).noStepFree).toBe(false)
    expect(outagePanelView(join({ kind: 'none' }), NOON, true).noStepFree).toBe(false)
  })

  it('writes the unknown line per kind mix, and is not known', () => {
    expect(unknownText('elevator')).toBe('Elevator status unavailable')
    expect(unknownText('escalator')).toBe('Escalator status unavailable')
    expect(unknownText('both')).toBe('Elevator and escalator status unavailable')
    expect(outagePanelView(join({ kind: 'unknown', kinds: 'both' }, false), NOON)).toEqual({
      known: false,
      noStepFree: false,
      body: { kind: 'unknown', text: 'Elevator and escalator status unavailable' },
    })
  })
})
