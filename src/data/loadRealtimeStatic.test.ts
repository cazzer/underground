import { afterEach, describe, expect, it, vi } from 'vitest'
import { index, segments, shapes, stations } from '../lib/realtime/fixture'
import { loadRealtimeStatic } from './loadRealtimeStatic'

function stubFetch(files: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(JSON.stringify(files[/data\/([\w-]+)\.json$/.exec(url)![1]!]), { status: 200 })),
  )
}
const NETWORK = { stations, shapes }
const FEED = stations.feedVersion

describe('loadRealtimeStatic', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('builds the join data from trip-index and segments', async () => {
    stubFetch({ 'trip-index': index, segments: { feedVersion: FEED, segments } })
    const data = await loadRealtimeStatic('/u/', NETWORK, 0, new AbortController().signal)
    expect(data.geometries.has('1..N03R')).toBe(true)
    expect(data.segments).toEqual(segments)
    expect(data.lookup.patterns).toEqual(index.patterns)
  })

  it('throws when segments come from a different build than the stations', async () => {
    stubFetch({ 'trip-index': index, segments: { feedVersion: 'other', segments } })
    await expect(loadRealtimeStatic('/u/', NETWORK, 0, new AbortController().signal)).rejects.toThrow(/feedVersion mismatch/)
  })

  it('throws when trip-index comes from a different build than the shapes', async () => {
    stubFetch({ 'trip-index': { ...index, feedVersion: 'other' }, segments: { feedVersion: FEED, segments } })
    await expect(loadRealtimeStatic('/u/', NETWORK, 0, new AbortController().signal)).rejects.toThrow(/feedVersion mismatch/)
  })

  it('names the url for a malformed file', async () => {
    stubFetch({ 'trip-index': { feedVersion: FEED }, segments: { feedVersion: FEED, segments } })
    await expect(loadRealtimeStatic('/u/', NETWORK, 0, new AbortController().signal)).rejects.toThrow('/u/data/trip-index.json: not a patterns file')
  })
})
