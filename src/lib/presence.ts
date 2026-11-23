/**
 * How present a drawn station interior is (o3r.4): 0 to 1, eased over PRESENCE_S as it joins the scene's drawn set
 * and back to 0 as it leaves, so a view interior never pops in or out with the set. Multiplied into that interior's
 * strokes, labels, lifted trains, its stations' marker fade and the shared veil. Pure; `stepPresence` allocates
 * nothing (it runs per frame).
 */

/** Seconds a presence takes from 0 to 1 or back. */
export const PRESENCE_S = 0.25

export interface Presence {
  /** The station interior's file id (its `stationId`). */
  readonly id: string
  /** 1 while it is in the drawn set, 0 while it leaves. */
  target: 0 | 1
  /** Linear progress toward 1, stepped per frame. */
  progress: number
  /** The eased presence (smoothstep of progress): what layers multiply by. */
  value: number
}

export function newPresence(id: string): Presence {
  return { id, target: 0, progress: 0, value: 0 }
}

/** Steps `p` by `dt` seconds toward its target; under reduced motion it snaps there. Returns the new value. */
export function stepPresence(p: Presence, dt: number, reduced: boolean): number {
  const step = reduced ? 1 : Math.max(dt, 0) / PRESENCE_S
  p.progress = p.target === 1 ? Math.min(p.progress + step, 1) : Math.max(p.progress - step, 0)
  const t = p.progress
  p.value = t * t * (3 - 2 * t)
  return p.value
}

interface HasStationId {
  stationId: string
}

/**
 * The interiors to keep mounted: the new drawn set in its order, then any previously shown one it dropped (still
 * fading out), in their previous order. Returns `prev` itself when nothing changed.
 */
export function mergeShown<T extends HasStationId>(prev: readonly T[], drawn: readonly T[]): readonly T[] {
  const leaving = prev.filter((m) => !drawn.some((d) => d.stationId === m.stationId))
  const next = leaving.length === 0 ? drawn : [...drawn, ...leaving]
  return next.length === prev.length && next.every((m, i) => m === prev[i]) ? prev : next
}

/** `shown` without interior `id` once it has faded out, unless it is drawn again; the same array when nothing goes. */
export function withoutFaded<T extends HasStationId>(shown: readonly T[], drawn: readonly T[], id: string): readonly T[] {
  if (drawn.some((d) => d.stationId === id)) return shown
  const next = shown.filter((m) => m.stationId !== id)
  return next.length === shown.length ? shown : next
}
