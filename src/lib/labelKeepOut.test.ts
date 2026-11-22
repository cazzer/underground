import { describe, expect, it } from 'vitest'
import { clearLabelTop } from './labelKeepOut'

const pts = (...p: number[]) => new Float32Array(p)

describe('clearLabelTop', () => {
  it('leaves a label clear of every point where it is', () => {
    expect(clearLabelTop(100, 50, 80, 12, pts(300, 55, 100, 200), 2, 4)).toBe(50)
    expect(clearLabelTop(100, 50, 80, 12, pts(), 0, 4)).toBe(50)
  })

  it('moves a label that covers a point to just below it', () => {
    expect(clearLabelTop(100, 50, 80, 12, pts(90, 56), 1, 4)).toBe(60)
    // Within the pad of its edge counts too.
    expect(clearLabelTop(100, 50, 80, 12, pts(142, 48), 1, 4)).toBe(52)
  })

  it('keeps moving while the move brings another point under it', () => {
    expect(clearLabelTop(100, 50, 80, 12, pts(90, 56, 110, 65), 2, 4)).toBe(69)
  })

  it('ignores a point off screen (NaN)', () => {
    expect(clearLabelTop(100, 50, 80, 12, pts(NaN, NaN), 1, 4)).toBe(50)
  })
})
