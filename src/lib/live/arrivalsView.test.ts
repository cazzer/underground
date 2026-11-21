import { describe, expect, it } from 'vitest'
import type { ArrivalGroup } from './arrivals'
import { deriveArrivalsView } from './arrivalsView'
import type { LiveStatus, LiveStatusKind } from './liveStatus'

const status = (kind: LiveStatusKind): LiveStatus => ({ kind, label: kind, detail: null })
const group: ArrivalGroup = { routeId: 'L', direction: 'N', headsign: '8 Av', times: [100] }

describe('deriveArrivalsView', () => {
  it('says off, whatever the data', () => {
    expect(deriveArrivalsView(status('off'), [group])).toEqual({ kind: 'message', text: 'Live arrivals not available yet' })
  })
  it('says connecting until there is something to read', () => {
    expect(deriveArrivalsView(status('connecting'), null)).toEqual({ kind: 'message', text: 'Connecting to live arrivals' })
  })
  it('says unavailable on error', () => {
    expect(deriveArrivalsView(status('error'), null)).toEqual({ kind: 'message', text: 'Live arrivals unavailable' })
  })
  it('shows rows with no note when live', () => {
    expect(deriveArrivalsView(status('live'), [group])).toEqual({ kind: 'rows', groups: [group], note: null })
  })
  it('is explicit when nothing is coming', () => {
    expect(deriveArrivalsView(status('live'), [])).toEqual({ kind: 'empty', note: null })
  })
  it('keeps showing times when stale, with a delayed note', () => {
    expect(deriveArrivalsView(status('stale'), [group])).toEqual({ kind: 'rows', groups: [group], note: 'Times may be delayed' })
    expect(deriveArrivalsView(status('stale'), [])).toEqual({ kind: 'empty', note: 'Times may be delayed' })
  })
})
