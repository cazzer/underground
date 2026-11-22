/**
 * The draw order of the basemap's pooled line buffers (one per class, basemapLayer.ts), so a new tile set rewrites as
 * little as it can: tiles still drawn keep their order (and so their offsets up to the first removed one), new tiles
 * append in drawn order.
 */

export interface PoolPlan {
  /** Tile keys in buffer order: the previous order minus removed tiles, then the new ones in `drawn` order. */
  order: number[]
  /** How many leading entries of `order` sit where they sat before: their segments need no rewrite. */
  keep: number
}

export function planPool(prevOrder: readonly number[], drawn: readonly number[]): PoolPlan {
  const wanted = new Set(drawn)
  const order: number[] = []
  let keep = -1
  for (let i = 0; i < prevOrder.length; i++) {
    const key = prevOrder[i]!
    if (wanted.has(key)) order.push(key)
    else if (keep < 0) keep = i
  }
  if (keep < 0) keep = prevOrder.length
  const had = new Set(order)
  for (const key of drawn) if (!had.has(key)) order.push(key)
  return { order, keep }
}
