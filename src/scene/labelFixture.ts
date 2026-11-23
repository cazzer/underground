/** The street label tests' stations: entrance and street label sources with measured sizes, laid out around an
 *  anchor, and a top-down camera over them. Test-only. */
import { PerspectiveCamera } from 'three'
import type { EntranceLabelSource, StreetLayer } from '../data/useStationStreets'
import { BUNDLE_STRIDE } from '../lib/routeBundles'
import type { Ground } from '../lib/projection'
import type { LabelCandidate, StreetLabelSource } from '../lib/streetRuns'

/** Top-down, north up, `height` m above (x, 0, z): about 2.54 px a meter at 500 m on an 800 px canvas. */
export function topDownCamera(x = 0, z = 0, height = 500): PerspectiveCamera {
  const camera = new PerspectiveCamera(35, 1, 10, 5000)
  camera.position.set(x, height, z)
  camera.up.set(0, 0, -1)
  camera.lookAt(x, 0, z)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

export interface FixtureEntrance {
  /** Meters from the anchor. */
  x: number
  z: number
  /** Measured label size, px. */
  w: number
  h?: number
  headHouse?: number
  elevator?: boolean
  unique?: boolean
  /** The fixture streets (indexes) the label names. */
  streets?: number[]
  /** The street-file entrance indexes it stands for; its own index (its position) when absent. */
  members?: number[]
}

export interface FixtureStreet {
  key: string
  w: number
  h?: number
  /** Each run's candidates, meters from the anchor, with the street's direction. */
  runs: LabelCandidate[][]
  /** Routes along every candidate and their lateral extent (lo, hi), meters; none when absent. */
  bundle?: [number, number, number]
}

export interface FixtureStation {
  id: string
  anchor: Ground
  /** A street layer holding just what the labels read (no line buffers or file). */
  layer: StreetLayer
  entrances: EntranceLabelSource[]
  streets: StreetLabelSource[]
  /** Every entrance mark, meters from the anchor: the labelled ones and `extraMarks`. */
  marks: Ground[]
  bundles: Float32Array[][]
  /** Per item (entrances, then streets): measured size, px. */
  w: number[]
  h: number[]
}

/** A straight run of candidates every `stepM` from (x0, z0) along unit (tx, tz), `count` of them. */
export function run(x0: number, z0: number, tx: number, tz: number, count: number, stepM = 40): LabelCandidate[] {
  return Array.from({ length: count }, (_, k) => ({ x: x0 + k * stepM * tx, z: z0 + k * stepM * tz, tx, tz }))
}

export function fixtureStation(
  id: string,
  anchor: Ground,
  spec: { entrances: FixtureEntrance[]; streets: FixtureStreet[]; extraMarks?: Ground[] },
): FixtureStation {
  const entrances = spec.entrances.map((e, i): EntranceLabelSource => {
    const members = e.members ?? [i]
    return {
      index: members[0]!,
      x: e.x,
      z: e.z,
      head: `${id} E${i}`,
      tail: '',
      text: `${id} E${i}`,
      spoken: `${id} E${i}`,
      count: members.length,
      members,
      elevator: e.elevator ?? false,
      unique: e.unique ?? true,
      keys: (e.streets ?? []).map((s) => spec.streets[s]!.key),
      headHouse: e.headHouse ?? i,
      streets: e.streets ?? [],
    }
  })
  const streets = spec.streets.map((s): StreetLabelSource => ({ key: s.key, text: s.key.toUpperCase(), lengthM: 100, runs: s.runs }))
  const bundles = spec.streets.map((s) =>
    s.runs.map((r) => {
      const out = new Float32Array(r.length * BUNDLE_STRIDE)
      if (s.bundle) for (let k = 0; k < r.length; k++) out.set(s.bundle, k * BUNDLE_STRIDE)
      return out
    }),
  )
  const marks = [...spec.entrances.map((e) => ({ x: e.x, z: e.z })), ...(spec.extraMarks ?? [])]
  // The labels never read a layer's buffers or file.
  const layer = { stationId: id, anchor, entrances, streets, marks } as unknown as StreetLayer
  return {
    id,
    anchor,
    layer,
    entrances,
    streets,
    marks,
    bundles,
    w: [...spec.entrances.map((e) => e.w), ...spec.streets.map((s) => s.w)],
    h: [...spec.entrances.map((e) => e.h ?? 12), ...spec.streets.map((s) => s.h ?? 12)],
  }
}

/**
 * A crowded station: two head houses of four entrances (an elevator in the first, the trip's exit in the second,
 * two sharing their text), an unlabelled extra mark, and five streets (Broadway with a two-route subway bundle, N 7 St
 * in two runs, a diagonal Bedford Av).
 */
export function crowdedStation(id = 'A', anchor: Ground = { x: 10, z: -5 }): FixtureStation {
  return fixtureStation(id, anchor, {
    entrances: [
      { x: -20, z: -30, w: 96, headHouse: 0, streets: [0, 1] },
      { x: -14, z: -30, w: 80, headHouse: 0 },
      { x: -20, z: -22, w: 60, headHouse: 0, elevator: true },
      { x: -8, z: -34, w: 70, headHouse: 0 },
      { x: 30, z: 25, w: 90, headHouse: 1, streets: [3] },
      { x: 36, z: 25, w: 110, headHouse: 1, streets: [2, 3] },
      { x: 30, z: 33, w: 74, headHouse: 1, unique: false },
      { x: 42, z: 30, w: 74, headHouse: 1, unique: false },
    ],
    streets: [
      { key: 'broadway', w: 64, runs: [run(-140, -40, 1, 0, 8)], bundle: [2, -6, 6] },
      { key: 'n 7 st', w: 44, runs: [run(0, -10, 0, -1, 4), run(0, 10, 0, 1, 4)] },
      { key: 'bedford av', w: 72, runs: [run(-60, -80, 0.6, 0.8, 6)] },
      { key: 'havemeyer st', w: 88, runs: [run(-120, 50, 1, 0, 7)] },
      { key: 'metropolitan av', w: 110, runs: [run(-60, -120, 0, 1, 7)] },
    ],
    extraMarks: [{ x: 60, z: -60 }],
  })
}

/** What one placement chose: per item its candidate (-1 for none) and that box's centre, rounded to 0.01 px. */
export interface PlacedSnapshot {
  out: number[]
  centres: ([number, number] | null)[]
}

const round = (v: number) => Math.round(v * 100) / 100

export function snapshot(out: Int16Array, start: Int32Array, cx: Float32Array, cy: Float32Array, count: number): PlacedSnapshot {
  const picks = Array.from(out.subarray(0, count))
  return {
    out: picks,
    centres: picks.map((k, i) => (k < 0 ? null : [round(cx[start[i]! + k]!), round(cy[start[i]! + k]!)])),
  }
}
