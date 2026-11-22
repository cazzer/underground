import { describe, expect, it } from 'vitest'
import { outageAnnouncement, type OutageSeen } from './outageAnnounce'

const seen = (stationId: string, out: Record<string, 'elevator' | 'escalator'>, known = true): OutageSeen => ({
  stationId,
  known,
  out: new Map(Object.entries(out)),
})

describe('outageAnnouncement', () => {
  it('is silent with no earlier view: a panel that just opened', () => {
    expect(outageAnnouncement(null, seen('L08', { EL358: 'elevator' }))).toBe('')
  })

  it('is silent when the station changed, whatever is out at either', () => {
    expect(outageAnnouncement(seen('L08', {}), seen('L06', { EL1: 'elevator' }))).toBe('')
    expect(outageAnnouncement(seen('L08', { EL358: 'elevator' }), seen('L06', {}))).toBe('')
  })

  it('is silent when nothing changed', () => {
    expect(outageAnnouncement(seen('L08', { EL358: 'elevator' }), seen('L08', { EL358: 'elevator' }))).toBe('')
  })

  it('says what went out and what came back at the same station', () => {
    expect(outageAnnouncement(seen('L08', {}), seen('L08', { EL358: 'elevator' }))).toBe('Elevator EL358 is now out of service.')
    expect(outageAnnouncement(seen('L08', { ES1: 'escalator' }), seen('L08', {}))).toBe('Escalator ES1 is back in service.')
    expect(outageAnnouncement(seen('L08', { ES1: 'escalator' }), seen('L08', { EL358: 'elevator' }))).toBe(
      'Elevator EL358 is now out of service. Escalator ES1 is back in service.',
    )
  })

  it('counts several instead of listing them', () => {
    expect(outageAnnouncement(seen('L08', {}), seen('L08', { EL1: 'elevator', ES1: 'escalator', ES2: 'escalator' }))).toBe(
      '3 machines are now out of service.',
    )
  })

  it('is silent across data that is not fresh: stale is not "back in service"', () => {
    expect(outageAnnouncement(seen('L08', { EL358: 'elevator' }), seen('L08', {}, false))).toBe('')
    expect(outageAnnouncement(seen('L08', {}, false), seen('L08', { EL358: 'elevator' }))).toBe('')
  })
})
