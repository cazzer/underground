/**
 * What to draw while tiles load: each wanted tile once it is ready, else its nearest ready ancestor, else the
 * previously drawn tiles inside it, so zooming never blanks the map. An ancestor can overlap a ready sibling
 * for as long as the rest of its children load.
 */
import { isDescendant, keyZ, parentKey } from './tileMath'

export function drawnTiles(wanted: readonly number[], has: (key: number) => boolean, previous: readonly number[]): number[] {
  const out = new Set<number>()
  for (const w of wanted) {
    if (has(w)) {
      out.add(w)
      continue
    }
    let a = w
    let found = false
    while (keyZ(a) > 0) {
      a = parentKey(a)
      if (has(a)) {
        out.add(a)
        found = true
        break
      }
    }
    if (found) continue
    for (const p of previous) if (isDescendant(p, w) && has(p)) out.add(p)
  }
  return [...out]
}
