/** A buffer update range in array elements, as three.js `BufferAttribute.updateRanges` takes them. */
export interface UpdateRange {
  start: number
  count: number
}

/**
 * Appends one range per run of dirty slots in [0, high) to `out`, `stride` elements per slot. A run
 * continues across up to `bridge` clean slots, trading a few extra bytes for fewer upload calls (clean
 * slots hold current data, so uploading them is harmless). Range objects come from `pool` (at least
 * ceil(high / 2) of them; three merges ranges in place, so each buffer needs its own pool). Returns how
 * many ranges it appended. No allocation.
 */
export function pushDirtyRanges(
  dirty: Uint8Array,
  high: number,
  stride: number,
  bridge: number,
  pool: UpdateRange[],
  out: UpdateRange[],
): number {
  let n = 0
  let i = 0
  while (i < high) {
    if (dirty[i] === 0) {
      i++
      continue
    }
    const start = i
    let end = i + 1
    for (i = end; i < high && i - end <= bridge; i++) if (dirty[i] !== 0) end = i + 1
    i = end
    const r = pool[n++]!
    r.start = start * stride
    r.count = (end - start) * stride
    out.push(r)
  }
  return n
}

export function createRangePool(size: number): UpdateRange[] {
  return Array.from({ length: size }, () => ({ start: 0, count: 0 }))
}
