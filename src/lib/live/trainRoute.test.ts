import { describe, expect, it } from 'vitest'
import type { RealtimeTrip } from '../../data/realtime'
import type { TripPattern } from '../../data/schema'
import { trainRouteId } from './trainRoute'

const routes = new Map([['W', 1], ['N', 1], ['7X', 1]])
const patterns: Record<string, TripPattern> = { 'N..N70R': { routeId: 'N', direction: 'N', stops: [] } }
const at = (route: string, shapeId: string) => trainRouteId({ trip: { route } as RealtimeTrip, shapeId }, routes, patterns)

describe('trainRouteId', () => {
  it('prefers the feed route when it is a known route', () => {
    expect(at('W', 'N..N70R')).toBe('W')
    expect(at('7X', 'N..N70R')).toBe('7X')
  })
  it('falls back to the joined shape route for an unknown feed route', () => {
    expect(at('X', 'N..N70R')).toBe('N')
  })
  it('is null when neither is known', () => {
    expect(at('X', 'missing')).toBeNull()
  })
})
