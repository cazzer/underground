import { afterEach, describe, expect, it, vi } from 'vitest'
import { BLOCKER_SLOTS, claimBlockerSlot, createLabelBlockers, releaseBlockerSlot } from './labelBlockers'

describe('label blocker slots', () => {
  afterEach(() => vi.restoreAllMocks())

  it('hands out distinct slots until full, then null with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const b = createLabelBlockers()
    const got = Array.from({ length: BLOCKER_SLOTS }, () => claimBlockerSlot(b))
    expect(new Set(got).size).toBe(BLOCKER_SLOTS)
    expect(got).not.toContain(null)
    expect(claimBlockerSlot(b)).toBeNull()
    expect(claimBlockerSlot(b)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('release empties the slot, bumps the version and frees it for the next claim', () => {
    const b = createLabelBlockers()
    const s = claimBlockerSlot(b)!
    for (let i = 1; i < BLOCKER_SLOTS; i++) claimBlockerSlot(b)
    b.counts[s] = 4
    const v = b.version
    releaseBlockerSlot(b, s)
    expect(b.counts[s]).toBe(0)
    expect(b.version).toBe(v + 1)
    expect(claimBlockerSlot(b)).toBe(s)
  })

  it('throws on releasing a slot not held', () => {
    const b = createLabelBlockers()
    expect(() => releaseBlockerSlot(b, 0)).toThrow(/not held/)
    const s = claimBlockerSlot(b)!
    releaseBlockerSlot(b, s)
    expect(() => releaseBlockerSlot(b, s)).toThrow(/not held/)
  })
})
