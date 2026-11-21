/**
 * Per-sample values (a band slot, a bundle half-width) to the eased TrackProfile the map draws. Pure.
 */
import { EMPTY_PROFILE, type TrackProfile } from './trackProfile'

/**
 * Removes out-and-back blips in place: a run of fewer than `minRun` samples whose neighbours on both sides hold
 * the same value takes that value (A, B, A becomes A, A, A). Repeats until none is left.
 */
export function suppressBlips(values: Float64Array, minRun: number): void {
  let changed = true
  while (changed) {
    changed = false
    const runs: [number, number][] = []
    for (let i = 0; i < values.length; ) {
      let j = i
      while (j < values.length && values[j] === values[i]) j++
      runs.push([i, j])
      i = j
    }
    for (let r = 1; r + 1 < runs.length; r++) {
      const [i, j] = runs[r]!
      const before = values[runs[r - 1]![0]]!
      if (j - i < minRun && before === values[runs[r + 1]![0]]) {
        values.fill(before, i, j)
        changed = true
        break
      }
    }
  }
}

/**
 * Constant between changes, each change eased (smoothstep, as profileAt draws it) from the value before to the
 * value after. A change sits midway between its two samples; changes closer together than `taperM` ease as one,
 * from the value before the first to the value after the last. Where routes only join (bits only added to
 * `masks`, the routes beside each sample) the ease ends at the change, so it is done before the lines run side by
 * side; where they only leave it starts there, once they have parted; otherwise (no masks, or routes joining and
 * leaving at once) it is centered. An ease never reaches past the midpoint to the next change. All zeros give
 * EMPTY_PROFILE.
 */
export function slotProfile(values: Float64Array, dist: Float64Array, length: number, taperM: number, masks?: Int32Array): TrackProfile {
  const n = values.length
  const cuts: number[] = []
  for (let i = 1; i < n; i++) if (values[i] !== values[i - 1]) cuts.push(i)
  const constant = () => (values[0] ? { d: Float64Array.of(0), y: Float64Array.of(values[0]) } : EMPTY_PROFILE)
  if (cuts.length === 0) return constant()
  // Clusters of cuts: first and last change, the sample before the first and the sample after the last.
  const clusters: { c0: number; c1: number; from: number; to: number }[] = []
  for (const i of cuts) {
    const mid = (dist[i - 1]! + dist[i]!) / 2
    const last = clusters.at(-1)
    if (last && mid - last.c1 < taperM) {
      last.c1 = mid
      last.to = i
    } else clusters.push({ c0: mid, c1: mid, from: i - 1, to: i })
  }
  const d: number[] = []
  const y: number[] = []
  clusters.forEach((k, j) => {
    const a = values[k.from]!
    const b = values[k.to]!
    if (a === b) return
    const lo = j > 0 ? (clusters[j - 1]!.c1 + k.c0) / 2 : 0
    const hi = j + 1 < clusters.length ? (k.c1 + clusters[j + 1]!.c0) / 2 : length
    const was = masks ? masks[k.from]! : 0
    const now = masks ? masks[k.to]! : 0
    const joins = (now & ~was) !== 0 && (was & ~now) === 0
    const leaves = (was & ~now) !== 0 && (now & ~was) === 0
    const before = joins ? taperM : leaves ? 0 : taperM / 2
    const after = leaves ? taperM : joins ? 0 : taperM / 2
    d.push(Math.max(k.c0 - before, lo), Math.min(k.c1 + after, hi))
    y.push(a, b)
  })
  if (d.length === 0) return constant()
  return { d: Float64Array.from(d), y: Float64Array.from(y) }
}
