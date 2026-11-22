/**
 * What to draw while tiles load. Each wanted tile: itself once ready; else the previously drawn ready tiles inside
 * it, if together they cover all of it (zooming out keeps the finer tiles); else its nearest ready ancestor; else
 * whatever previously drawn tiles lie inside it, so zooming never blanks the map. An ancestor can overlap a ready
 * sibling for as long as the rest of its children load.
 */
import { isDescendant, keyZ, parentKey } from './tileMath'

/** The share of a tile the given distinct descendants cover, counting none that lies inside another. */
function coverShare(tile: number, inside: readonly number[]): number {
  const z = keyZ(tile)
  let share = 0
  for (const k of inside) {
    if (inside.some((o) => o !== k && isDescendant(k, o))) continue
    share += 4 ** (z - keyZ(k))
  }
  return share
}

export function drawnTiles(wanted: readonly number[], has: (key: number) => boolean, previous: readonly number[]): number[] {
  const out = new Set<number>()
  for (const w of wanted) {
    if (has(w)) {
      out.add(w)
      continue
    }
    const inside = previous.filter((p) => isDescendant(p, w) && has(p))
    if (inside.length > 0 && coverShare(w, inside) >= 1 - 1e-9) {
      for (const p of inside) out.add(p)
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
    if (!found) for (const p of inside) out.add(p)
  }
  return [...out]
}
