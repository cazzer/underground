/** Sizing the shared label pass's arrays for a set of drawn stations (o3r.6): every allocation the pass makes, only
 *  when the set (or the nearby markers) changes. */
import { MAX_OUTLINE_SAMPLES } from '../lib/interiorOutline'
import { BLOCKER_SLOTS, MAX_LEVEL_BLOCKERS } from '../lib/labelBlockers'
import { GROUP } from '../lib/labelDeclutter'
import { BOX, RECT } from '../lib/labelGeometry'
import type { Ground } from '../lib/projection'
import { ENTRANCE_SLOTS, FIXED_RECTS, MAX_LABEL_INTERIORS, STREET_SLOTS, type LabelPlacement, type PlacementStation } from './labelPlacementState'

/** Stations one placement holds (`stationOf` is a byte). */
const MAX_STATIONS = 255

/** Rect groups: the fixed rects, each station's marks, the markers and ring, each level label slot, each interior. */
export function groupCapacity(stations: number): number {
  return 1 + stations + 1 + BLOCKER_SLOTS + MAX_LABEL_INTERIORS
}

/**
 * The arrays for `stations` (in label order) and the `nearby` station markers. Items, boxes and rects are the sums
 * over the stations; each station's street keys share one id across stations, so a street two files hold labels once.
 */
export function createLabelPlacement(stations: readonly PlacementStation[], nearby: readonly Ground[]): LabelPlacement {
  if (stations.length > MAX_STATIONS) throw new Error(`Street labels: ${stations.length} stations, over ${MAX_STATIONS}`)
  const count = stations.length
  const segItem0 = new Int32Array(count)
  const segStreet0 = new Int32Array(count)
  const segEnd = new Int32Array(count)
  const segMark0 = new Int32Array(count)
  const segMarkEnd = new Int32Array(count)
  let n = 0
  let boxes = 0
  let runs = 0
  let rect = FIXED_RECTS
  stations.forEach(({ layer }, s) => {
    segItem0[s] = n
    n += layer.entrances.length
    segStreet0[s] = n
    n += layer.streets.length
    segEnd[s] = n
    segMark0[s] = rect
    rect += layer.marks.length
    segMarkEnd[s] = rect
    boxes += layer.entrances.length * ENTRANCE_SLOTS
    for (const street of layer.streets) {
      for (const r of street.runs) boxes += r.length * STREET_SLOTS
      runs = Math.max(runs, street.runs.length)
    }
  })
  if (n > 0x7fff) throw new Error(`Street labels: ${n} labels, over the ${0x7fff} the order holds`)
  const markerRect = rect
  const levelRect = markerRect + nearby.length + 1
  const rects = levelRect + BLOCKER_SLOTS * MAX_LEVEL_BLOCKERS + MAX_LABEL_INTERIORS * MAX_OUTLINE_SAMPLES
  const stationOf = new Uint8Array(n)
  const local = new Int16Array(n)
  const keyId = new Int16Array(n).fill(-1)
  const keys = new Map<string, number>()
  stations.forEach(({ layer }, s) => {
    for (let k = 0; k < layer.entrances.length; k++) {
      stationOf[segItem0[s]! + k] = s
      local[segItem0[s]! + k] = k
    }
    layer.streets.forEach((street, k) => {
      const i = segStreet0[s]! + k
      stationOf[i] = s
      local[i] = k
      if (!keys.has(street.key)) keys.set(street.key, keys.size)
      keyId[i] = keys.get(street.key)!
    })
  })
  const minus = (len: number) => new Int16Array(len).fill(-1)
  const exemptWords = Math.max(1, Math.ceil(n / 32))
  return {
    stations,
    nearby,
    segItem0,
    segStreet0,
    segEnd,
    segMark0,
    segMarkEnd,
    markerRect,
    levelRect,
    stationOf,
    local,
    keyId,
    keyPlaced: new Uint8Array(keys.size),
    w: new Float32Array(n),
    h: new Float32Array(n),
    lines: new Uint8Array(n).fill(1),
    cand: {
      boxes: new Float32Array(boxes * BOX),
      start: new Int32Array(n),
      size: new Int32Array(n),
      order: new Int16Array(n).map((_, i) => i),
      count: n,
    },
    bounds: {
      viewport: { left: 0, top: 0, right: 0, bottom: 0 },
      rects: new Float32Array(rects * RECT),
      count: 0,
      exempt: new Uint32Array(rects * exemptWords),
      exemptWords,
      groups: new Float32Array(groupCapacity(count) * GROUP),
      groupCount: 0,
    },
    cx: new Float32Array(boxes),
    cy: new Float32Array(boxes),
    angle: new Float32Array(boxes),
    srcRun: new Int16Array(boxes),
    src: new Int16Array(boxes),
    srcSide: new Int8Array(boxes),
    lastFirst: new Uint8Array(n),
    lastRun: minus(n),
    lastSrc: minus(n),
    lastSide: new Int8Array(n),
    lastAngle: new Float32Array(n).fill(NaN),
    prefer: minus(n),
    out: minus(n),
    markX: new Float32Array(n),
    markY: new Float32Array(n),
    score: new Float64Array(n),
    houseBest: new Float64Array(n),
    named: new Uint8Array(n),
    runCount: new Int16Array(runs),
    runDone: new Uint8Array(runs),
  }
}

/**
 * Copies last placement's picks into `next` for every station whose layer object `prev` also holds (a rebuilt layer,
 * even for the same station, starts afresh: its items may differ), so a station joining or leaving doesn't move the
 * others' labels.
 */
export function carryPlacement(next: LabelPlacement, prev: LabelPlacement): void {
  next.stations.forEach((station, s) => {
    const t = prev.stations.findIndex((o) => o.layer === station.layer)
    if (t < 0) return
    const from = prev.segItem0[t]!
    const to = prev.segEnd[t]!
    const at = next.segItem0[s]!
    next.lastFirst.set(prev.lastFirst.subarray(from, to), at)
    next.lastRun.set(prev.lastRun.subarray(from, to), at)
    next.lastSrc.set(prev.lastSrc.subarray(from, to), at)
    next.lastSide.set(prev.lastSide.subarray(from, to), at)
    next.lastAngle.set(prev.lastAngle.subarray(from, to), at)
  })
}
