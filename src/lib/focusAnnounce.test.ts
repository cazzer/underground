import { describe, expect, it } from 'vitest'
import { focusAnnouncement, shouldAnnounce } from './focusAnnounce'

describe('shouldAnnounce', () => {
  const base = { focusedId: 'A', covered: false, focusInPanelAtEntry: false, focusInPanelNow: false }
  it('announces a focused, visible panel that focus never entered', () => {
    expect(shouldAnnounce(base)).toBe(true)
  })
  it('stays quiet with no station or a covering panel', () => {
    expect(shouldAnnounce({ ...base, focusedId: null })).toBe(false)
    expect(shouldAnnounce({ ...base, covered: true })).toBe(false)
  })
  it('stays quiet when focus entered the panel meanwhile (search pick, closed train)', () => {
    expect(shouldAnnounce({ ...base, focusInPanelNow: true })).toBe(false)
  })
  it('announces when focus was already in the panel at entry (A to B, heading kept focus)', () => {
    expect(shouldAnnounce({ ...base, focusInPanelAtEntry: true, focusInPanelNow: true })).toBe(true)
  })
})

describe('focusAnnouncement', () => {
  it('is the station name alone', () => {
    expect(focusAnnouncement('Bedford Av')).toBe('Showing Bedford Av')
    expect(focusAnnouncement('125 St', 'The downtown 1 train skips this station now.')).toBe('Showing 125 St. The downtown 1 train skips this station now.')
  })
})
