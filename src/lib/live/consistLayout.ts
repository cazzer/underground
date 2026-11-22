import type { BandView } from '../bandOffset'
import { CAR_HEIGHT_M, CAR_WIDTH_M } from '../carDims'
import { writeChordMatrix } from '../markerMatrices'
import { consistCenter, MAX_CARS, type Consist } from './consist'
import { createTrackPoint, trackPointInto, type DrawnTrack, type TrackPoint } from './trackPoint'

/** Per-frame sizes shared by every train. */
export interface CarFrame {
  /** Gap between car bodies at full size, meters. */
  gapM: number
  /** Halo margin around each body at full size, meters. */
  rimM: number
  /** Body width at full size before widening, meters (the halo's base width). */
  widthM: number
  /** At least 1: enlarges the body section (width and height) so a far train stays a few pixels wide. */
  crossScale: number
  /** Height of the car floor and its halo above the track (the profile's y). */
  y: number
  /**
   * The depth factor (tilt.ts, 0 to 1) the body height is drawn at: 0 flattens each car to its roof footprint at
   * the floor, so a top-down view has no height, and the cars grow into 3D as the camera tips.
   */
  extrude: number
  /**
   * Set for the selected train's outline shells (carGeometry's open tube): each body grows by this much on every
   * side, and at a joint between two cars reaches past the gap's middle, so one train's shells join into one outline.
   */
  outlineM?: number
}

/**
 * How far a shell reaches past the middle of a joint, at least, so a curve leaves no notch at the outer corner; it
 * also reaches the outline's own width past it, which covers a tight curve.
 */
const JOIN_OVERLAP_M = 0.25

/** Where a train's cars sit along its shape: car c spans [rear + c * step, rear + (c + 1) * step]. */
export interface ConsistSpan {
  cars: number
  /** Car pitch at full size, meters: the consist's, shortened so the train fits a short shape. */
  pitch: number
  /** Pitch scaled by the unfold (mix times fade). */
  step: number
  rear: number
}

/**
 * The span of a `consist` drawn at `shown` along a shape `lineLength` long, unfolded by `mixK` (0..1): what
 * writeConsist lays the cars out on, and what a pick tests against. No allocation.
 */
export function consistSpanInto(out: ConsistSpan, lineLength: number, shown: number, consist: Consist, mixK: number): ConsistSpan {
  const n = Math.min(consist.cars, MAX_CARS)
  out.cars = n
  out.pitch = Math.min(consist.pitchM, lineLength / n)
  out.step = out.pitch * mixK
  out.rear = consistCenter(lineLength, shown, n * out.step) - (n * out.step) / 2
  return out
}

/** Reused per-frame state: the chord ends of the car being written, and the train's span. */
export interface ConsistScratch {
  a: TrackPoint
  b: TrackPoint
  span: ConsistSpan
}

/** No offset: writeConsist's default `shift`. */
const NO_SHIFT: TrackPoint = Object.freeze(createTrackPoint())

export function createConsistScratch(): ConsistScratch {
  return { a: createTrackPoint(), b: createTrackPoint(), span: { cars: 0, pitch: 0, step: 0, rear: 0 } }
}

/**
 * Writes one train's car bodies and halos at instances `slot * MAX_CARS + c`. The cars are laid end to end
 * along the track around the consist center, each at its chord's midpoint facing along the chord, so a curve
 * bends the train and no car leaves the line. Chord ends are track points (trackPointInto in `view`: on the
 * route's band, at the track's height), so on a ramp
 * each car (and its halo) pitches with the track. `mix * k` (each 0..1) scales spacing and car length around the
 * center, so at mix = 0 the train collapses to the dot's point; `k` (the slot's fade) also scales the body
 * section, so a fading train shrinks to nothing while the handoff keeps it legible. Car geometry is unit
 * length along z at full width and height; the halo is a unit plane. `widen` (about 1) enlarges one train's
 * body slightly so two trains on one shape don't z-fight. `shift` moves the whole train (a shape change's
 * offset easing out, shapeCarry.ts). With `frame.outlineM` the bodies are written as outline shells, grown by it
 * (times `mix * k`) on every side and joined across the gaps. Instances past the consist get zero matrices. No
 * allocation; never throws.
 */
export function writeConsist(
  bodies: Float32Array,
  halos: Float32Array,
  slot: number,
  track: DrawnTrack,
  view: BandView,
  shown: number,
  consist: Consist,
  mix: number,
  k: number,
  widen: number,
  frame: CarFrame,
  scratch: ConsistScratch,
  shift: TrackPoint = NO_SHIFT,
): void {
  const base = slot * MAX_CARS
  const line = track.line
  const n = line.points.length === 0 ? 0 : Math.min(consist.cars, MAX_CARS)
  if (n > 0) {
    const u = mix * k
    const { pitch, step, rear } = consistSpanInto(scratch.span, line.length, shown, consist, u)
    const cross = k * frame.crossScale * widen
    // Height grows in over the first quarter of the handoff, so a stub of a train can't pop up at a tilt.
    const height = cross * Math.min(1, 4 * mix) * frame.extrude
    // Widened too (end faces), but never past the gap's middle, so neighbouring cars can't overlap.
    const fullLength = Math.max(pitch - frame.gapM, 0.5 * pitch)
    const bodyLength = u * Math.min(widen * fullLength, Math.max(fullLength, pitch - 0.5 * frame.gapM))
    const haloWidth = cross * frame.widthM + 2 * u * frame.rimM
    const haloLength = step + 2 * u * frame.rimM
    const grow = u * (frame.outlineM ?? 0)
    const halfGap = (step - bodyLength) / 2 + Math.max(JOIN_OVERLAP_M, grow)
    let a = scratch.a
    let b = scratch.b
    trackPointInto(track, rear, view, a)
    for (let c = 0; c < n; c++) {
      trackPointInto(track, rear + (c + 1) * step, view, b)
      const ux = b.x - a.x
      const uy = b.y - a.y
      const uz = b.z - a.z
      const mx = (a.x + b.x) / 2 + shift.x
      const my = (a.y + b.y) / 2 + frame.y + shift.y
      const mz = (a.z + b.z) / 2 + shift.z
      if (grow > 0) {
        // Ends of the train grow by `grow`; a joint reaches its neighbour. The center moves to keep the ends put.
        const back = c === 0 ? grow : Math.max(grow, halfGap)
        const front = c === n - 1 ? grow : Math.max(grow, halfGap)
        const len = Math.hypot(ux, uy, uz)
        const along = len > 0 ? (front - back) / (2 * len) : 0
        const sx = cross + (2 * grow) / CAR_WIDTH_M
        const sy = height + (2 * grow) / CAR_HEIGHT_M
        writeChordMatrix(bodies, base + c, mx + ux * along, my - grow + uy * along, mz + uz * along, ux, uy, uz, sx, sy, bodyLength + back + front)
      } else writeChordMatrix(bodies, base + c, mx, my, mz, ux, uy, uz, cross, height, bodyLength)
      writeChordMatrix(halos, base + c, mx, my, mz, ux, uy, uz, haloWidth, 1, haloLength)
      const t = a
      a = b
      b = t
    }
  }
  clearCars(bodies, halos, slot, n)
}

/**
 * The two end faces of one train's outline shells (`shells`, slot 0, as writeConsist wrote them with `outlineM`):
 * instance 0 closes the rear car's rear end, instance 1 the front car's front end (its shell turned half a turn about
 * its up axis, which the section's symmetry allows and which keeps the face's winding). Zeroed for no cars. No allocation.
 */
export function writeEndCaps(shells: Float32Array, caps: Float32Array): void {
  let last = -1
  for (let c = 0; c < MAX_CARS; c++) if (shells[c * 16 + 15] !== 0) last = c
  if (last < 0) {
    caps.fill(0, 0, 32)
    return
  }
  const f = last * 16
  for (let j = 0; j < 16; j++) {
    caps[j] = shells[j]!
    caps[16 + j] = (j < 3 || (j >= 8 && j < 11) ? -1 : 1) * shells[f + j]!
  }
}

/** Zeroes the slot's instances from car `from` on (all of them by default). */
export function clearCars(bodies: Float32Array, halos: Float32Array, slot: number, from = 0): void {
  const start = (slot * MAX_CARS + from) * 16
  const end = (slot + 1) * MAX_CARS * 16
  bodies.fill(0, start, end)
  halos.fill(0, start, end)
}
