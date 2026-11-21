import { describe, expect, it } from 'vitest'
import { clockNow, updateClockOffset } from './clock'

describe('updateClockOffset', () => {
  it('takes the first sample as is', () => {
    expect(updateClockOffset(null, 1000, 5000)).toBe(995)
  })

  it('ignores a later sample served from an older memo', () => {
    const first = updateClockOffset(null, 1000, 5000)
    // 20 s later the Worker answers with a snapshot generated only 5 s after the first.
    expect(updateClockOffset(first, 1005, 25_000)).toBe(first)
  })

  it('raises the offset for a fresher sample', () => {
    const first = updateClockOffset(null, 1000, 5000)
    expect(updateClockOffset(first, 1030, 25_000)).toBe(1005)
  })
})

describe('clockNow', () => {
  it('adds the elapsed time to the offset', () => {
    expect(clockNow(995, 7500)).toBe(1002.5)
  })

  it('never runs backward across polls with mixed memo ages', () => {
    const polls: [generatedAt: number, receivedMs: number][] = [
      [1000, 5000],
      [1012, 25_000], // fresh
      [1015, 45_000], // memo 14 s old
      [1055, 65_000], // fresh
      [1050, 85_000], // memo, older than the last
    ]
    let offset: number | null = null
    let last = -Infinity
    for (const [generatedAt, receivedMs] of polls) {
      // Just before the poll, then just after it.
      if (offset !== null) {
        const before = clockNow(offset, receivedMs - 1)
        expect(before).toBeGreaterThanOrEqual(last)
        last = before
      }
      offset = updateClockOffset(offset, generatedAt, receivedMs)
      const after = clockNow(offset, receivedMs)
      expect(after).toBeGreaterThanOrEqual(last)
      last = after
    }
  })
})
