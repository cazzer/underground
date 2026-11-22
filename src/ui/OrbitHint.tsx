import { useSyncExternalStore } from 'react'
import { useFocus } from '../lib/focus'
import { hasTurned, subscribeTurned } from '../lib/orbitTurned'
import { useTrainSelection } from '../lib/trainSelection'

const coarse = window.matchMedia('(pointer: coarse)')

function subscribeCoarse(onChange: () => void): () => void {
  coarse.addEventListener('change', onChange)
  return () => coarse.removeEventListener('change', onChange)
}

const isCoarse = () => coarse.matches

/**
 * The header's muted turn hint: shown while a station is focused (rotation only works then), until the
 * visitor's first turn this session. Not while the camera follows a train: the panel then is the train's.
 */
export function OrbitHint() {
  const { focusedId } = useFocus()
  const { following } = useTrainSelection()
  const touch = useSyncExternalStore(subscribeCoarse, isCoarse)
  const turned = useSyncExternalStore(subscribeTurned, hasTurned)
  if (!focusedId || turned || following) return null
  return <p className="text-xs text-ink-dim">{touch ? 'Twist or slide two fingers to turn' : 'Right-drag or Shift-drag to turn'}</p>
}
