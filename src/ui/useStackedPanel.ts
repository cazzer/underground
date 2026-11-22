import { useSyncExternalStore } from 'react'

/**
 * Below Tailwind's `sm` breakpoint the HUD stacks its panel over the map (above it, the panel is a side
 * column beside the map). Lists cap and collapse only when stacked: a landscape phone (844×390) gets the
 * side column, where a cap would only hide rows without uncovering any map.
 */
const STACKED = '(max-width: 639px)'

/** Whether the HUD's panel is stacked over the map right now. */
export function isStackedPanel(): boolean {
  return window.matchMedia(STACKED).matches
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(STACKED)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** `isStackedPanel`, live. */
export function useStackedPanel(): boolean {
  return useSyncExternalStore(subscribe, isStackedPanel)
}
