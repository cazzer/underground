import { useSyncExternalStore } from 'react'

const coarse = window.matchMedia('(pointer: coarse)')

function subscribe(onChange: () => void): () => void {
  coarse.addEventListener('change', onChange)
  return () => coarse.removeEventListener('change', onChange)
}

const isCoarse = () => coarse.matches

/** The station panel's one-line hint for turning the view (rotation only works while a station is focused). */
export function OrbitHint() {
  const touch = useSyncExternalStore(subscribe, isCoarse)
  return (
    <p className="mt-2 text-xs text-ink-dim">{touch ? 'Drag two fingers sideways to turn' : 'Right-drag or Shift-drag to turn'}</p>
  )
}
