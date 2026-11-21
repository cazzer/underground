import { describe, expect, it } from 'vitest'
import { FEED_IDS, RT_SCHEMA_VERSION, STALE_AFTER_S, type FeedId, type RealtimeSnapshot } from '../../data/realtime'
import { deriveLiveStatus, FEED_LABELS, type LiveStatusInput } from './liveStatus'

const NOW = 1_795_228_554

function snapshot(stale: FeedId[] = [], generatedAt = NOW): RealtimeSnapshot {
  const feeds = Object.fromEntries(
    FEED_IDS.map((id) => [id, { headerTimestamp: NOW, error: null, stale: stale.includes(id), droppedEntities: 0, trips: [] }]),
  ) as unknown as RealtimeSnapshot['feeds']
  return { version: RT_SCHEMA_VERSION, generatedAt, feeds }
}

const base: LiveStatusInput = {
  configured: true,
  fatal: false,
  staticReady: true,
  snapshot: snapshot(),
  failures: 0,
  schemaMismatch: false,
  nowS: NOW,
  online: true,
}
const status = (over: Partial<LiveStatusInput>) => deriveLiveStatus({ ...base, ...over })

describe('deriveLiveStatus', () => {
  it('is off when no source is configured, whatever else is set', () => {
    expect(status({ configured: false, fatal: true })).toEqual({
      kind: 'off',
      label: 'Live trains off',
      updatedAt: null, detail: 'Not available yet',
    })
  })

  it('says to reload after a fatal error, without technical detail', () => {
    expect(status({ fatal: true, schemaMismatch: true })).toEqual({
      kind: 'error',
      label: 'Live trains unavailable, reload to retry',
      updatedAt: null, detail: null,
    })
  })

  it('offers an update, not a retry, on a schema mismatch', () => {
    expect(status({ schemaMismatch: true, failures: 3 })).toEqual({ kind: 'error', label: 'Update available, reload', updatedAt: null, detail: null })
  })

  it('does not change on one failed poll while a snapshot exists', () => {
    expect(status({ failures: 1 }).kind).toBe('live')
  })

  it('shows a delay, not an error, when polls keep failing but trains are still drawn', () => {
    expect(status({ failures: 2 })).toEqual({ kind: 'stale', label: 'Live data delayed', updatedAt: NOW, detail: null })
    expect(status({ failures: 9 }).kind).toBe('stale')
  })

  it('is an error only when there is no snapshot to show', () => {
    expect(status({ snapshot: null, failures: 1 })).toEqual({
      kind: 'error',
      label: 'Live trains unavailable, retrying',
      updatedAt: null, detail: null,
    })
  })

  it('is connecting before the first snapshot and while the join data loads', () => {
    expect(status({ snapshot: null }).kind).toBe('connecting')
    expect(status({ staticReady: false }).kind).toBe('connecting')
  })

  it('names the delayed feeds in feed order', () => {
    expect(status({ snapshot: snapshot(['l', 'ace']) })).toEqual({
      kind: 'stale',
      label: 'Live, some lines delayed',
      updatedAt: null, detail: 'Delayed: ACE, L',
    })
  })

  it('goes stale when the snapshot is older than the feed staleness limit', () => {
    expect(status({ nowS: NOW + STALE_AFTER_S }).kind).toBe('live')
    expect(status({ nowS: NOW + STALE_AFTER_S + 1 })).toMatchObject({ kind: 'stale', label: 'Live data delayed' })
  })

  it('is live otherwise', () => {
    expect(status({})).toEqual({ kind: 'live', label: 'Live trains', updatedAt: null, detail: null })
  })
})

describe('FEED_LABELS', () => {
  it('labels every feed', () => {
    expect(FEED_IDS.map((f) => FEED_LABELS[f])).toEqual(['1–7', 'ACE', 'BDFM', 'G', 'JZ', 'NQRW', 'L', 'SIR'])
  })

  it('goes yellow at once when the device is offline, with the time of the data still drawn', () => {
    const s = status({ online: false, snapshot: snapshot([], NOW - 30) })
    expect(s.kind).toBe('stale')
    expect(s.label).toBe('Offline, showing last update')
    expect(s.updatedAt).toBe(NOW - 30)
  })

  it('says offline with nothing to show before the first snapshot', () => {
    expect(status({ online: false, snapshot: null }).kind).toBe('error')
  })

  it('reports the update time when the data is delayed, not when only some lines are', () => {
    expect(status({ failures: 2 }).updatedAt).toBe(NOW)
    expect(status({ nowS: NOW + STALE_AFTER_S + 1 }).updatedAt).toBe(NOW)
    expect(status({ snapshot: snapshot(['l']) }).updatedAt).toBeNull()
    expect(status({}).updatedAt).toBeNull()
  })
})
