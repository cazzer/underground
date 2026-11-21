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
  staticError: null,
  prepareError: null,
  layerError: null,
  snapshot: snapshot(),
  failures: 0,
  lastError: null,
  nowS: NOW,
}
const status = (over: Partial<LiveStatusInput>) => deriveLiveStatus({ ...base, ...over })

describe('deriveLiveStatus', () => {
  it('is off when no source is configured, whatever else is set', () => {
    expect(status({ configured: false, staticError: 'x' })).toEqual({
      kind: 'off',
      label: 'Live trains off',
      detail: 'No realtime source configured',
    })
  })

  it('reports static, prepare and layer errors as unavailable, in that order', () => {
    expect(status({ staticError: 'a', prepareError: 'b', layerError: 'c' })).toMatchObject({ kind: 'error', detail: 'a' })
    expect(status({ prepareError: 'b', layerError: 'c' })).toMatchObject({ detail: 'b' })
    expect(status({ layerError: 'c' })).toMatchObject({ label: 'Live trains unavailable', detail: 'c' })
  })

  it('does not flip to error on one failed poll while a snapshot exists', () => {
    expect(status({ failures: 1, lastError: 'HTTP 500' }).kind).toBe('live')
  })

  it('errors on two failures in a row, or one with no snapshot', () => {
    expect(status({ failures: 2, lastError: 'HTTP 500' })).toEqual({
      kind: 'error',
      label: 'Live data delayed, retrying',
      detail: 'HTTP 500',
    })
    expect(status({ failures: 1, snapshot: null, lastError: 'HTTP 500' })).toMatchObject({
      kind: 'error',
      label: 'Live data unavailable, retrying',
    })
  })

  it('is connecting before the first snapshot', () => {
    expect(status({ snapshot: null }).kind).toBe('connecting')
  })

  it('names the delayed feeds in feed order', () => {
    expect(status({ snapshot: snapshot(['l', 'ace']) })).toEqual({
      kind: 'stale',
      label: 'Live, some lines delayed',
      detail: 'Delayed: ACE, L',
    })
  })

  it('goes stale when the snapshot is older than the feed staleness limit', () => {
    expect(status({ nowS: NOW + STALE_AFTER_S }).kind).toBe('live')
    expect(status({ nowS: NOW + STALE_AFTER_S + 1 })).toMatchObject({ kind: 'stale', label: 'Live data delayed' })
  })

  it('is live otherwise', () => {
    expect(status({})).toEqual({ kind: 'live', label: 'Live', detail: null })
  })
})

describe('FEED_LABELS', () => {
  it('labels every feed', () => {
    expect(FEED_IDS.map((f) => FEED_LABELS[f])).toEqual(['1–7', 'ACE', 'BDFM', 'G', 'JZ', 'NQRW', 'L', 'SIR'])
  })
})
