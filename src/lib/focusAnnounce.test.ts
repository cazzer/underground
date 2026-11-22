import { describe, expect, it } from 'vitest'
import { focusAnnouncement, shouldAnnounce } from './focusAnnounce'

describe('shouldAnnounce', () => {
  const base = { focusedId: 'A', covered: false, focusInPanel: false }
  it('announces a focused, visible panel that holds no focus', () => {
    expect(shouldAnnounce(base)).toBe(true)
  })
  it('stays quiet with no station, a covering panel, or focus already in the panel', () => {
    expect(shouldAnnounce({ ...base, focusedId: null })).toBe(false)
    expect(shouldAnnounce({ ...base, covered: true })).toBe(false)
    expect(shouldAnnounce({ ...base, focusInPanel: true })).toBe(false)
  })
})

describe('focusAnnouncement', () => {
  it('is the station name alone', () => {
    expect(focusAnnouncement('Bedford Av')).toBe('Showing Bedford Av')
  })
})
