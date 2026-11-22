import { theme } from '../theme'

/**
 * TEMPORARY override of the exit path's look for the 2q7.12 look cards. `?exitPath=a` draws the centerline only;
 * `b` (default) also restrokes each connector it takes and the exit's entrance square. `?exitColor=rim|focus` draws
 * it in `trainSelectedRim` or `stationFocus` instead of `exitPath` (pink, the default). Once the cards are decided,
 * remove together:
 * - this file: pass the chosen `restroke` and color straight from ExitPath.tsx (and drop `restroke` from
 *   `ExitPathOptions` in interiorPath.ts with its unchosen branch, and its interiorPath tests, if A wins)
 * - ExitPath.tsx: the `exitPathLook` import; useStreetLabels.ts: its `exitPathLook.color` tint becomes `theme.exitPath`
 * - theme.ts: the `?exitColor=` sentence in the `exitPath` doc (and the token itself if rim or focus wins, with its
 *   theme.test.ts exitPath block)
 * - AGENTS.md: the `?exitPath=` / `?exitColor=` TEMPORARY note in the theme bullets and in the ExitPath.tsx entry
 */
export interface ExitPathLook {
  restroke: boolean
  color: string
}

export function resolveExitPathLook(search: string): ExitPathLook {
  const params = new URLSearchParams(search)
  const color = params.get('exitColor')
  return {
    restroke: params.get('exitPath') !== 'a',
    color: color === 'rim' ? theme.trainSelectedRim : color === 'focus' ? theme.stationFocus : theme.exitPath,
  }
}

export const exitPathLook: ExitPathLook = resolveExitPathLook(window.location.search)
