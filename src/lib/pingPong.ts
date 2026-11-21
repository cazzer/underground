/** Triangle wave: 0 -> length -> 0 over a 2*length cycle. Returns 0 for a non-positive length. */
export function pingPong(distance: number, length: number): number {
  if (length <= 0) return 0
  const period = 2 * length
  const m = ((distance % period) + period) % period
  return m <= length ? m : period - m
}
