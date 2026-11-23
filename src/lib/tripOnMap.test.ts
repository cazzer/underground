import { describe, expect, it } from 'vitest'
import { ON_MAP_QUIET_MS, shouldAnnounceOnMap } from './tripOnMap'

describe('shouldAnnounceOnMap', () => {
  const base = { focusedId: 'X', previousId: 'Y', shown: true, isEnd: false, planLoading: false, stepped: false, sinceSettledMs: null }
  it('says a station that newly took focus while the panel is in front', () => {
    expect(shouldAnnounceOnMap(base)).toBe(true)
    expect(shouldAnnounceOnMap({ ...base, previousId: null })).toBe(true)
  })
  it('stays silent when focus did not change (opening, a swap, an end pick, the cover going)', () => {
    expect(shouldAnnounceOnMap({ ...base, previousId: 'X' })).toBe(false)
  })
  it('stays silent with nothing focused, the panel not in front, or an end focused', () => {
    expect(shouldAnnounceOnMap({ ...base, focusedId: null })).toBe(false)
    expect(shouldAnnounceOnMap({ ...base, shown: false })).toBe(false)
    expect(shouldAnnounceOnMap({ ...base, isEnd: true })).toBe(false)
    expect(shouldAnnounceOnMap({ ...base, stepped: true })).toBe(false)
  })
  it('never talks over a loading or just-settled result', () => {
    expect(shouldAnnounceOnMap({ ...base, planLoading: true })).toBe(false)
    expect(shouldAnnounceOnMap({ ...base, sinceSettledMs: ON_MAP_QUIET_MS - 1 })).toBe(false)
    expect(shouldAnnounceOnMap({ ...base, sinceSettledMs: ON_MAP_QUIET_MS })).toBe(true)
  })
})
