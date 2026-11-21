import { describe, expect, it } from 'vitest'
import { decideCorrection, EASE_MAX_M, GLIDE_MAX_MPS, HOLD_BACK_M, type CorrectionInput } from './motion'

const base: CorrectionInput = { errM: 0, remainingM: 1000, timeToArriveS: 60, fixedPlan: false, reducedMotion: false }
const decide = (over: Partial<CorrectionInput>) => decideCorrection({ ...base, ...over })

describe('decideCorrection', () => {
  it('leaves small errors to the per-frame ease, forward or back', () => {
    expect(decide({ errM: EASE_MAX_M })).toEqual({ kind: 'none' })
    expect(decide({ errM: -300 })).toEqual({ kind: 'none' })
    expect(decide({ errM: -HOLD_BACK_M })).toEqual({ kind: 'none' })
  })

  it('cross-fades a backward error past the hold limit', () => {
    expect(decide({ errM: -HOLD_BACK_M - 1 })).toEqual({ kind: 'crossfade' })
  })

  it('cross-fades a backward error against a plan that is not moving, since waiting would never end', () => {
    expect(decide({ errM: -EASE_MAX_M, fixedPlan: true })).toEqual({ kind: 'none' })
    expect(decide({ errM: -EASE_MAX_M - 1, fixedPlan: true })).toEqual({ kind: 'crossfade' })
    expect(decide({ errM: -900, fixedPlan: false })).toEqual({ kind: 'none' })
  })

  it('caps a glide at the longest allowed', () => {
    expect(decide({ errM: 400, remainingM: 1000, timeToArriveS: 600 })).toEqual({ kind: 'glide', durationS: 90 })
  })

  it('glides a larger forward error so the train arrives on time', () => {
    expect(decide({ errM: 400, remainingM: 900, timeToArriveS: 60 })).toEqual({ kind: 'glide', durationS: 60 })
  })

  it('cross-fades when the glide would need a faster train than the limit', () => {
    expect(decide({ errM: 400, remainingM: GLIDE_MAX_MPS * 60 + 1, timeToArriveS: 60 })).toEqual({ kind: 'crossfade' })
    expect(decide({ errM: 400, remainingM: GLIDE_MAX_MPS * 60, timeToArriveS: 60 })).toMatchObject({ kind: 'glide' })
  })

  it('closes the gap at a steady speed when the plan is not moving', () => {
    // A fixed (or overdue) plan: no arrival to time against.
    expect(decide({ errM: 300, timeToArriveS: null })).toEqual({ kind: 'glide', durationS: 20 })
    expect(decide({ errM: 300, timeToArriveS: 0.5 })).toEqual({ kind: 'glide', durationS: 20 })
    expect(decide({ errM: 3000, timeToArriveS: null })).toEqual({ kind: 'crossfade' })
  })

  it('cross-fades every correction past the ease range under reduced motion', () => {
    expect(decide({ errM: 400, reducedMotion: true })).toEqual({ kind: 'crossfade' })
    expect(decide({ errM: 100, reducedMotion: true })).toEqual({ kind: 'none' })
  })
})
