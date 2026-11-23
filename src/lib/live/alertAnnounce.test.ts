import { describe, expect, it } from 'vitest'
import { changesAnnouncement, type ChangesSeen } from './alertAnnounce'

const row = (kind: 'skipped' | 'suspended' | 'other', now: boolean, spoken: string) => ({ kind, now, spoken })
const seen = (rows: Record<string, ReturnType<typeof row>>, over: Partial<ChangesSeen> = {}): ChangesSeen => ({ stationId: 's', known: true, rows: new Map(Object.entries(rows)), ...over })
const SKIP = row('skipped', true, '1: skips this station.')

describe('changesAnnouncement', () => {
  it('is silent on open, on another station, and without fresh data on either side', () => {
    expect(changesAnnouncement(null, seen({ a: SKIP }))).toBe('')
    expect(changesAnnouncement(seen({}, { stationId: 't' }), seen({ a: SKIP }))).toBe('')
    expect(changesAnnouncement(seen({}, { known: false }), seen({ a: SKIP }))).toBe('')
    expect(changesAnnouncement(seen({ a: SKIP }), seen({}, { known: false }))).toBe('')
  })

  it('is silent when nothing changed', () => {
    expect(changesAnnouncement(seen({ a: SKIP }), seen({ a: SKIP }))).toBe('')
  })

  it('speaks a new change, or counts several', () => {
    expect(changesAnnouncement(seen({}), seen({ a: row('skipped', false, '1: skips this station, from 11:45 PM.') }))).toBe('New service change. 1: skips this station, from 11:45 PM.')
    expect(changesAnnouncement(seen({}), seen({ a: SKIP, b: row('other', true, 'x') }))).toBe('2 new service changes at this station.')
  })

  it('speaks a skip or suspension that comes into effect, not a notice', () => {
    const later = row('skipped', false, '1: skips this station, from 11:45 PM.')
    expect(changesAnnouncement(seen({ a: later }), seen({ a: SKIP }))).toBe('Now in effect. 1: skips this station.')
    expect(changesAnnouncement(seen({ a: row('other', false, 'x') }), seen({ a: row('other', true, 'x') }))).toBe('')
  })

  it('speaks changes that ended', () => {
    expect(changesAnnouncement(seen({ a: SKIP }), seen({}))).toBe('A service change ended.')
    expect(changesAnnouncement(seen({ a: SKIP, b: SKIP }), seen({}))).toBe('2 service changes ended.')
  })
})
