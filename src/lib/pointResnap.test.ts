import { describe, expect, it } from 'vitest'
import { POINT_RESNAP_WINDOW_MS, shouldResnapPoint, type PointLanding, type ResnapInput } from './pointResnap'

const landing: PointLanding = { at: 1000, target: { x: 120, z: -340 }, distance: 1800 }
const still: ResnapInput = { now: 1100, flying: false, tookOver: false, target: { x: 120, z: -340 }, distance: 1800 }

describe('shouldResnapPoint', () => {
  it('re-snaps a landing the camera still sits on, inside the window', () => {
    expect(shouldResnapPoint(landing, still)).toBe(true)
    expect(shouldResnapPoint(landing, { ...still, now: 1000 + POINT_RESNAP_WINDOW_MS })).toBe(true)
  })

  it('tolerates the float error of the snap itself', () => {
    expect(shouldResnapPoint(landing, { ...still, target: { x: 120.000001, z: -340 }, distance: 1800.0000001 })).toBe(true)
  })

  it('never after the window', () => {
    expect(shouldResnapPoint(landing, { ...still, now: 1001 + POINT_RESNAP_WINDOW_MS })).toBe(false)
  })

  it('never during a flight or after a gesture', () => {
    expect(shouldResnapPoint(landing, { ...still, flying: true })).toBe(false)
    expect(shouldResnapPoint(landing, { ...still, tookOver: true })).toBe(false)
  })

  it('never once something moved the camera (a follow, another flight that landed, a pan or a zoom)', () => {
    expect(shouldResnapPoint(landing, { ...still, target: { x: 121, z: -340 } })).toBe(false)
    expect(shouldResnapPoint(landing, { ...still, distance: 1700 })).toBe(false)
  })
})
