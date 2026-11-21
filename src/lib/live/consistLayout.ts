import { writeChordMatrix } from '../markerMatrices'
import type { Ground } from '../projection'
import { pointAtDistanceInto, type Polyline } from '../realtime/polyline'
import { profileAt, type TrackProfile } from '../trackProfile'
import { consistCenter, MAX_CARS, type Consist } from './consist'

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
}

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

/** The track's height at `distance`, clamped to the line like pointAtDistanceInto, so a car end's y matches its ground point. */
export function trackY(line: Polyline, profile: TrackProfile, distance: number): number {
  return profileAt(profile, Math.min(Math.max(distance, 0), line.length))
}

/** Reused per-frame state: the chord ends of the car being written, and the train's span. */
export interface ConsistScratch {
  a: Ground
  b: Ground
  span: ConsistSpan
}

export function createConsistScratch(): ConsistScratch {
  return { a: { x: 0, z: 0 }, b: { x: 0, z: 0 }, span: { cars: 0, pitch: 0, step: 0, rear: 0 } }
}

/**
 * Writes one train's car bodies and halos at instances `slot * MAX_CARS + c`. The cars are laid end to end
 * along `line` around the consist center, each at its chord's midpoint facing along the chord, so a curve
 * bends the train and no car leaves the line. Chord ends sit at the track's height (`profile`), so on a ramp
 * each car (and its halo) pitches with the track. `mix * k` (each 0..1) scales spacing and car length around the
 * center, so at mix = 0 the train collapses to the dot's point; `k` (the slot's fade) also scales the body
 * section, so a fading train shrinks to nothing while the handoff keeps it legible. Car geometry is unit
 * length along z at full width and height; the halo is a unit plane. `widen` (about 1) enlarges one train's
 * body slightly so two trains on one shape don't z-fight. Instances past the consist get zero matrices.
 * No allocation; never throws.
 */
export function writeConsist(
  bodies: Float32Array,
  halos: Float32Array,
  slot: number,
  line: Polyline,
  profile: TrackProfile,
  shown: number,
  consist: Consist,
  mix: number,
  k: number,
  widen: number,
  frame: CarFrame,
  scratch: ConsistScratch,
): void {
  const base = slot * MAX_CARS
  const n = line.points.length === 0 ? 0 : Math.min(consist.cars, MAX_CARS)
  if (n > 0) {
    const u = mix * k
    const { pitch, step, rear } = consistSpanInto(scratch.span, line.length, shown, consist, u)
    const cross = k * frame.crossScale * widen
    // Height grows in over the first quarter of the handoff, so a stub of a train can't pop up at a tilt.
    const height = cross * Math.min(1, 4 * mix)
    // Widened too (end faces), but never past the gap's middle, so neighbouring cars can't overlap.
    const fullLength = Math.max(pitch - frame.gapM, 0.5 * pitch)
    const bodyLength = u * Math.min(widen * fullLength, Math.max(fullLength, pitch - 0.5 * frame.gapM))
    const haloWidth = cross * frame.widthM + 2 * u * frame.rimM
    const haloLength = step + 2 * u * frame.rimM
    let a = scratch.a
    let b = scratch.b
    pointAtDistanceInto(line, rear, a)
    let ya = trackY(line, profile, rear)
    for (let c = 0; c < n; c++) {
      const d = rear + (c + 1) * step
      pointAtDistanceInto(line, d, b)
      const yb = trackY(line, profile, d)
      const ux = b.x - a.x
      const uy = yb - ya
      const uz = b.z - a.z
      const mx = (a.x + b.x) / 2
      const my = (ya + yb) / 2 + frame.y
      const mz = (a.z + b.z) / 2
      writeChordMatrix(bodies, base + c, mx, my, mz, ux, uy, uz, cross, height, bodyLength)
      writeChordMatrix(halos, base + c, mx, my, mz, ux, uy, uz, haloWidth, 1, haloLength)
      const t = a
      a = b
      b = t
      ya = yb
    }
  }
  clearCars(bodies, halos, slot, n)
}

/** Zeroes the slot's instances from car `from` on (all of them by default). */
export function clearCars(bodies: Float32Array, halos: Float32Array, slot: number, from = 0): void {
  const start = (slot * MAX_CARS + from) * 16
  const end = (slot + 1) * MAX_CARS * 16
  bodies.fill(0, start, end)
  halos.fill(0, start, end)
}
