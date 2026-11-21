import { useSyncExternalStore } from 'react'

const COARSE = '(pointer: coarse)'

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(COARSE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const isCoarse = () => window.matchMedia(COARSE).matches

/** The station panel's one-line hint for turning the view (rotation only works while a station is focused). */
export function OrbitHint() {
  const touch = useSyncExternalStore(subscribe, isCoarse)
  return <p className="mt-2 text-xs text-ink-dim">{touch ? 'Two fingers to turn' : 'Right-drag to turn'}</p>
}
