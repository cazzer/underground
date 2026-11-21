import { useSyncExternalStore } from 'react'
import { useFocus } from '../lib/focus'
import { hasTurned, subscribeTurned } from '../lib/orbitTurned'

const coarse = window.matchMedia('(pointer: coarse)')

function subscribeCoarse(onChange: () => void): () => void {
  coarse.addEventListener('change', onChange)
  return () => coarse.removeEventListener('change', onChange)
}

const isCoarse = () => coarse.matches

/**
 * The header's muted turn hint: shown while a station is focused (rotation only works then), until the
 * visitor's first turn this session.
 */
export function OrbitHint() {
  const { focusedId } = useFocus()
  const touch = useSyncExternalStore(subscribeCoarse, isCoarse)
  const turned = useSyncExternalStore(subscribeTurned, hasTurned)
  if (!focusedId || turned) return null
  return <p className="text-xs text-ink-dim">{touch ? 'Drag two fingers sideways to turn' : 'Right-drag or Shift-drag to turn'}</p>
}
