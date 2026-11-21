import { describe, expect, it } from 'vitest'
import { REFRESH_GRACE_MS, cacheDecision } from './cache'

const memo = { body: '{}', expiresAt: 1000 }

describe('cacheDecision', () => {
  it('serves a fresh body from memory, even while a refresh is running', () => {
    expect(cacheDecision(999, memo, null)).toBe('memory')
    expect(cacheDecision(999, memo, 500)).toBe('memory')
  })

  it('refreshes when the body has expired and nothing is refreshing', () => {
    expect(cacheDecision(1000, memo, null)).toBe('refresh')
  })

  it('serves the stale body while a recent refresh is in flight', () => {
    expect(cacheDecision(1500, memo, 1200)).toBe('stale')
    expect(cacheDecision(1200 + REFRESH_GRACE_MS - 1, memo, 1200)).toBe('stale')
  })

  it('takes over a refresh that has been running too long', () => {
    expect(cacheDecision(1200 + REFRESH_GRACE_MS, memo, 1200)).toBe('refresh')
  })

  it('always refreshes when there is no body yet', () => {
    expect(cacheDecision(0, null, null)).toBe('refresh')
    expect(cacheDecision(0, null, 0)).toBe('refresh')
  })
})
