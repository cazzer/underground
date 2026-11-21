import { describe, expect, it } from 'vitest'
import routesRaw from '../../../public/data/routes.json?raw'
import { FEED_IDS, RT_SCHEMA_VERSION, STALE_AFTER_S, type FeedId, type RealtimeSnapshot } from '../../data/realtime'
import type { RoutesFile } from '../../data/schema'
import { ROUTE_FEED, stationFeedHealth } from './feedHealth'

const NOW = 1_795_228_554
const routes = (JSON.parse(routesRaw) as RoutesFile).routes

function snapshot(over: Partial<Record<FeedId, { error?: string; stale?: boolean }>> = {}): RealtimeSnapshot {
  const feeds = Object.fromEntries(
    FEED_IDS.map((id) => {
      const o = over[id]
      const error = o?.error ?? null
      return [id, { headerTimestamp: error ? null : NOW, error, stale: error !== null || (o?.stale ?? false), droppedEntities: 0, trips: [] }]
    }),
  ) as unknown as RealtimeSnapshot['feeds']
  return { version: RT_SCHEMA_VERSION, generatedAt: NOW, feeds }
}

describe('ROUTE_FEED', () => {
  it('covers every route in routes.json with a real feed', () => {
    for (const r of routes) expect(FEED_IDS, `route ${r.id}`).toContain(ROUTE_FEED[r.id])
  })
  it('names no route that routes.json lacks', () => {
    const ids = new Set(routes.map((r) => r.id))
    for (const id of Object.keys(ROUTE_FEED)) expect(ids.has(id), id).toBe(true)
  })
})

describe('stationFeedHealth', () => {
  it('is healthy when every serving feed is fine', () => {
    expect(stationFeedHealth(snapshot(), ['A', 'F'], 0, NOW)).toEqual({ unavailable: [], delayed: false })
  })
  it('lists only the station routes whose feed failed, and ignores unrelated feeds', () => {
    const snap = snapshot({ bdfm: { error: 'HTTP 503' }, l: { error: 'timeout' } })
    expect(stationFeedHealth(snap, ['A', 'C', 'F', 'FX'], 0, NOW).unavailable).toEqual(['F', 'FX'])
    expect(stationFeedHealth(snap, ['A', 'C'], 0, NOW)).toEqual({ unavailable: [], delayed: false })
  })
  it('is delayed for a stale serving feed but not an unrelated one', () => {
    const snap = snapshot({ ace: { stale: true } })
    expect(stationFeedHealth(snap, ['A'], 0, NOW)).toEqual({ unavailable: [], delayed: true })
    expect(stationFeedHealth(snap, ['L'], 0, NOW)).toEqual({ unavailable: [], delayed: false })
  })
  it('is delayed everywhere when polls keep failing or the snapshot is old', () => {
    expect(stationFeedHealth(snapshot(), ['L'], 2, NOW).delayed).toBe(true)
    expect(stationFeedHealth(snapshot(), ['L'], 1, NOW).delayed).toBe(false)
    expect(stationFeedHealth(snapshot(), ['L'], 0, NOW + STALE_AFTER_S + 1).delayed).toBe(true)
  })
})
