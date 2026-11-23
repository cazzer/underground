import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { newPresence, stepPresence, type Presence } from '../lib/presence'
import { prefersReducedMotion } from '../lib/reducedMotion'

/** The drawn interiors' presences (presence.ts) and the veil's, shared by Scene: useSceneInteriors sets the targets, the driver steps them. */
export interface PresenceStore {
  /** One per shown interior (drawn or still fading out), replaced by useSceneInteriors when that list changes. */
  items: readonly Presence[]
  /** Look A's screen veil: target 1 while the veil rule holds (useSceneInteriors' `veiled`). */
  veil: Presence
  /** Per frame: the highest presence over `items`. */
  max: number
  /** Per frame: veil.value x max, the share of the veil drawn (ScreenVeil) and the lifted cars' tint follow (LiveTrains). */
  veilShare: number
}

export function createPresenceStore(): PresenceStore {
  return { items: [], veil: newPresence('veil'), max: 0, veilShare: 0 }
}

interface PresenceDriverProps {
  store: PresenceStore
  /** Called once when a leaving interior's presence reaches 0, so it can unmount. */
  onFaded: (id: string) => void
}

/**
 * Steps every presence once per frame at -0.25 (after the camera and controls, before the draws at 0 that read them:
 * StationInterior, ScreenVeil, LiveTrains' lifted cars, the station markers and ties). Allocates nothing per frame.
 */
export function PresenceDriver({ store, onFaded }: PresenceDriverProps): null {
  const reported = useMemo(() => new WeakSet<Presence>(), [])
  useFrame((_, dt) => {
    const reduced = prefersReducedMotion()
    let max = 0
    for (let i = 0; i < store.items.length; i++) {
      const p = store.items[i]!
      const v = stepPresence(p, dt, reduced)
      if (v > max) max = v
      if (p.target === 0 && v === 0 && !reported.has(p)) {
        reported.add(p)
        onFaded(p.id)
      } else if (p.target === 1) reported.delete(p)
    }
    store.max = max
    store.veilShare = stepPresence(store.veil, dt, reduced) * max
  }, -0.25)
  return null
}
