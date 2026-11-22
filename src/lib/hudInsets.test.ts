import { describe, expect, it } from 'vitest'
import { hudInsets, sameInsets } from './hudInsets'

describe('hudInsets', () => {
  const root = { top: 0, bottom: 844 }

  it('measures the header from the root top and only the footer to the root bottom (a panel never counts)', () => {
    expect(hudInsets(root, { top: 16, bottom: 92 }, { top: 752, bottom: 828 })).toEqual({ top: 92, bottom: 92 })
  })

  it('follows a root that does not start at the viewport top', () => {
    expect(hudInsets({ top: 20, bottom: 864 }, { top: 36, bottom: 112 }, { top: 772, bottom: 848 })).toEqual({ top: 92, bottom: 92 })
  })

  it('never goes negative', () => {
    expect(hudInsets(root, { top: -50, bottom: -10 }, { top: 900, bottom: 950 })).toEqual({ top: 0, bottom: 0 })
  })
})

describe('sameInsets', () => {
  it('compares both bands', () => {
    expect(sameInsets({ top: 1, bottom: 2 }, { top: 1, bottom: 2 })).toBe(true)
    expect(sameInsets({ top: 1, bottom: 2 }, { top: 1, bottom: 3 })).toBe(false)
    expect(sameInsets(null, { top: 0, bottom: 0 })).toBe(false)
  })
})
