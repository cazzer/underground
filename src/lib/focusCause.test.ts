import { describe, expect, it } from 'vitest'
import { causeAfterCamera, focusAnnouncement, shouldAnnounce } from './focusCause'

describe('causeAfterCamera', () => {
  it("marks a newly auto-focused station as the camera's, even after a user pick", () => {
    expect(causeAfterCamera(null, 'A', 'user')).toBe('camera')
    expect(causeAfterCamera('A', 'B', 'user')).toBe('camera')
  })
  it('keeps the cause when the same station stays focused or focus drops', () => {
    expect(causeAfterCamera('A', 'A', 'user')).toBe('user')
    expect(causeAfterCamera('A', null, 'user')).toBe('user')
    expect(causeAfterCamera('A', null, 'camera')).toBe('camera')
  })
})

describe('shouldAnnounce', () => {
  const base = { cause: 'camera', focusedId: 'A', covered: false, focusInPanel: false } as const
  it('announces an auto-focused, visible panel that has no focus', () => {
    expect(shouldAnnounce(base)).toBe(true)
  })
  it('stays quiet for user picks, no station, a covering panel, or focus already in the panel', () => {
    expect(shouldAnnounce({ ...base, cause: 'user' })).toBe(false)
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
