/**
 * Session flag: the visitor has turned a focused station's view at least once, so the header's turn
 * hint stops showing. Set from the scene's frame loop, read by the HUD through useSyncExternalStore.
 */
let turned = false
const listeners = new Set<() => void>()

export function markTurned(): void {
  if (turned) return
  turned = true
  for (const l of listeners) l()
}

export function subscribeTurned(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function hasTurned(): boolean {
  return turned
}
