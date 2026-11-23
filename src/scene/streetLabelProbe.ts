/** Dev-only test tooling for the shared street label pass: `__underground.streetLabels()` counts each drawn
 *  station's placed labels and reports the pass's timings. The timings are recorded in every build (allocation-free). */
import type { StreetLabelsProbe } from '../lib/focus'
import type { LabelState } from './useStreetLabels'

/** How many of the latest placement runs the percentile reads. */
export const LABEL_TIMING_SAMPLES = 240

export interface LabelTimings {
  ms: Float32Array
  /** Runs recorded since the last reset (the ring holds the latest LABEL_TIMING_SAMPLES). */
  runs: number
  last: number
  max: number
}

export function newTimings(): LabelTimings {
  return { ms: new Float32Array(LABEL_TIMING_SAMPLES), runs: 0, last: 0, max: 0 }
}

export function recordTiming(t: LabelTimings, ms: number): void {
  t.ms[t.runs % LABEL_TIMING_SAMPLES] = ms
  t.runs++
  t.last = ms
  if (ms > t.max) t.max = ms
}

function probe(st: LabelState | null, reset: boolean): StreetLabelsProbe {
  const t = st?.timings
  const n = t ? Math.min(t.runs, LABEL_TIMING_SAMPLES) : 0
  const sorted = t ? Array.from(t.ms.subarray(0, n)).sort((x, y) => x - y) : []
  const out: StreetLabelsProbe = {
    stations: [],
    lastMs: t?.last ?? 0,
    maxMs: t?.max ?? 0,
    p95Ms: n > 0 ? sorted[Math.min(n - 1, Math.floor(0.95 * n))]! : 0,
    samples: n,
  }
  if (st) {
    const p = st.place
    const placed = (from: number, to: number) => {
      let c = 0
      for (let i = from; i < to; i++) if (p.out[i]! >= 0) c++
      return c
    }
    p.stations.forEach(({ layer }, s) => {
      const e0 = p.segItem0[s]!
      const s0 = p.segStreet0[s]!
      const end = p.segEnd[s]!
      out.stations.push({ id: layer.stationId, entrances: [placed(e0, s0), s0 - e0], streets: [placed(s0, end), end - s0] })
    })
  }
  if (reset && t) {
    t.runs = 0
    t.max = 0
  }
  return out
}

/** Installs the dev probe over the label state `get` returns; returns its uninstall. */
export function installStreetLabelProbe(get: () => LabelState | null): () => void {
  if (!import.meta.env.DEV) return () => {}
  window.__underground = { ...window.__underground, streetLabels: (reset = false) => probe(get(), reset) }
  return () => {
    if (window.__underground) delete window.__underground.streetLabels
  }
}
