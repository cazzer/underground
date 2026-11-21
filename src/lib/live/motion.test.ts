import { describe, expect, it } from 'vitest'
import {
  decideCorrection,
  EASE_MAX_M,
  GLIDE_CATCHUP_MPS,
  GLIDE_CONTINUE_MPS,
  GLIDE_MAX_M,
  GLIDE_MAX_S,
  GLIDE_MIN_S,
  HOLD_BACK_M,
  type CorrectionInput,
} from './motion'

const base: CorrectionInput = { errM: 0, glideLeftS: null, fixedPlan: false, reducedMotion: false }
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

  it('sizes a glide from the gap: the catch-up speed, within the shortest and longest glide', () => {
    expect(decide({ errM: 300 })).toEqual({ kind: 'glide', durationS: 300 / GLIDE_CATCHUP_MPS })
    expect(decide({ errM: EASE_MAX_M + 1 })).toEqual({ kind: 'glide', durationS: GLIDE_MIN_S })
    expect(decide({ errM: GLIDE_MAX_M })).toEqual({ kind: 'glide', durationS: GLIDE_MAX_S })
    // The same for a plan that isn't moving: the gap, not the time to the next stop, sets the pace.
    expect(decide({ errM: 300, fixedPlan: true })).toEqual({ kind: 'glide', durationS: 300 / GLIDE_CATCHUP_MPS })
  })

  it('continues a running glide unless the rest would close faster than an eased glide peaks', () => {
    expect(decide({ errM: 300, glideLeftS: 8 })).toEqual({ kind: 'continue' })
    expect(decide({ errM: GLIDE_CONTINUE_MPS * 4, glideLeftS: 4 })).toEqual({ kind: 'continue' })
    // A small gap mid-glide stays on the glide rather than stepping down to the ease; none ahead stops it.
    expect(decide({ errM: 40, glideLeftS: 2 })).toEqual({ kind: 'continue' })
    expect(decide({ errM: 0, glideLeftS: 2 })).toEqual({ kind: 'none' })
    expect(decide({ errM: 300, glideLeftS: 1 })).toEqual({ kind: 'glide', durationS: 300 / GLIDE_CATCHUP_MPS })
  })

  it('cross-fades a forward gap too large to glide', () => {
    expect(decide({ errM: GLIDE_MAX_M + 1 })).toEqual({ kind: 'crossfade' })
    expect(decide({ errM: GLIDE_MAX_M + 1, glideLeftS: 5 })).toEqual({ kind: 'crossfade' }) // 240 m/s: too fast to continue
  })

  it('cross-fades every correction past the ease range under reduced motion', () => {
    expect(decide({ errM: 400, reducedMotion: true })).toEqual({ kind: 'crossfade' })
    expect(decide({ errM: 100, reducedMotion: true })).toEqual({ kind: 'none' })
  })
})
