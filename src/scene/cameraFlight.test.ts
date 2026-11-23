import { describe, expect, it } from 'vitest'
import { EXIT_DISTANCE } from '../lib/focusMachine'
import { tiltForDistance } from '../lib/tilt'
import { PLACE_LANDING_DISTANCE, pointFlight, type PointRequest } from './cameraFlight'

const viewport = { width: 390, height: 844 }
const insets = { top: 110, bottom: 380 }
const request = (source: PointRequest['source']): PointRequest => ({ kind: 'point', center: { x: 1200, z: -800 }, radiusM: 250, source, nonce: 1 })

describe('pointFlight', () => {
  it('lands a searched place at street zoom, tilted, whatever the radius', () => {
    const dest = pointFlight(request('place'), viewport, insets, 35, 50_000)
    expect(dest.distance).toBe(PLACE_LANDING_DISTANCE)
    expect(tiltForDistance(dest.distance)).toBeGreaterThan(0.5)
    expect(dest.stationId).toBeNull()
    expect(dest.azimuth).toBeNull()
  })

  it('lands a location fix top-down at the exit distance or farther', () => {
    const dest = pointFlight(request('locate'), viewport, insets, 35, 50_000)
    expect(dest.distance).toBeGreaterThanOrEqual(EXIT_DISTANCE)
    expect(tiltForDistance(dest.distance)).toBe(0)
  })

  it('keeps a place inside the controls\' zoom-out limit', () => {
    expect(pointFlight(request('place'), viewport, insets, 35, 400).distance).toBe(400)
  })
})
