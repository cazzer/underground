import { describe, expect, it } from 'vitest'
import { failedRecently, MAX_VIEW_INTERIORS, PHONE_VIEW_INTERIORS, VIEW_RETRY_MS, viewInteriorCap } from './viewStations'

describe('viewInteriorCap', () => {
  it('is 3 on a desktop and 2 when the shorter side is under 600 px, either orientation', () => {
    expect(MAX_VIEW_INTERIORS).toBe(3)
    expect(PHONE_VIEW_INTERIORS).toBe(2)
    expect(viewInteriorCap(1440, 900)).toBe(3)
    expect(viewInteriorCap(600, 600)).toBe(3)
    expect(viewInteriorCap(390, 844)).toBe(2)
    expect(viewInteriorCap(844, 390)).toBe(2)
    expect(viewInteriorCap(599, 1200)).toBe(2)
  })
})

describe('failedRecently', () => {
  it('skips an id for VIEW_RETRY_MS after its failure', () => {
    const at = new Map([['L08', 1000]])
    expect(failedRecently(at, 'L08', 1000)).toBe(true)
    expect(failedRecently(at, 'L08', 1000 + VIEW_RETRY_MS - 1)).toBe(true)
    expect(failedRecently(at, 'L08', 1000 + VIEW_RETRY_MS)).toBe(false)
    expect(failedRecently(at, 'L10', 1000)).toBe(false)
  })
})
