import { selectedCarMix } from './consist'

/** How long the selected train takes to unfold onto its own car mix, and to fold back once deselected. */
export const SELECT_EASE_S = 0.4

/**
 * The selected train's car mix: it unfolds into cars at distances where the rest are still dots. `slot` eases
 * from the shared carMix toward `target` (selectedCarMix this frame) by `blend`; the previous selection eases
 * back by `prevBlend`. Mutated in place, once per frame.
 */
export interface SelectedMix {
  /** The selected slot, -1 for none. */
  slot: number
  blend: number
  /** The slot selected before, still folding back to the shared mix; -1 for none. */
  prevSlot: number
  prevBlend: number
  /** selectedCarMix at this frame's camera distance. */
  target: number
}

export function createSelectedMix(): SelectedMix {
  return { slot: -1, blend: 0, prevSlot: -1, prevBlend: 0, target: 0 }
}

/**
 * Selects `slot` (-1 for none). The old selection folds back from where it is, unless `keepPrev` is false
 * (its slot now holds another trip, which must not inherit the cars). Reselecting the slot still folding back
 * picks up from its blend.
 */
export function selectSlot(s: SelectedMix, slot: number, keepPrev: boolean): void {
  if (slot === s.slot) return
  const blend = slot >= 0 && slot === s.prevSlot ? s.prevBlend : 0
  const keep = keepPrev && s.slot >= 0 && s.blend > 0
  s.prevSlot = keep ? s.slot : -1
  s.prevBlend = keep ? s.blend : 0
  s.slot = slot
  s.blend = blend
}

/** A freed slot: whatever trip takes it next starts from the shared mix. */
export function forgetSlot(s: SelectedMix, slot: number): void {
  if (slot === s.slot) {
    s.slot = -1
    s.blend = 0
  }
  if (slot === s.prevSlot) {
    s.prevSlot = -1
    s.prevBlend = 0
  }
}

/** Advances both eases by `dt` seconds (at once under reduced motion) and takes this frame's target. */
export function stepSelectedMix(s: SelectedMix, distance: number, dt: number, reducedMotion: boolean): void {
  s.target = selectedCarMix(distance)
  const step = reducedMotion ? 1 : dt / SELECT_EASE_S
  if (s.slot >= 0) s.blend = Math.min(1, s.blend + step)
  if (s.prevSlot >= 0) {
    s.prevBlend = Math.max(0, s.prevBlend - step)
    if (s.prevBlend === 0) s.prevSlot = -1
  }
}

/** Whether any slot draws above the shared mix this frame, so the cars must be on even where every other train is a dot. */
export function selectedMixActive(s: SelectedMix): boolean {
  return s.target > 0 && ((s.slot >= 0 && s.blend > 0) || s.prevSlot >= 0)
}

/** Slot i's car mix, given the shared carMix `base`: eased toward the target for the selected and previous slots. */
export function slotMix(s: SelectedMix, i: number, base: number): number {
  const b = i === s.slot ? s.blend : i === s.prevSlot ? s.prevBlend : -1
  if (b <= 0) return base
  const t = b * b * (3 - 2 * b)
  return base + (Math.max(s.target, base) - base) * t
}
