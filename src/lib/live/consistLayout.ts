import { writeYawMatrix } from '../markerMatrices'
import type { Ground } from '../projection'
import { pointAtDistanceInto, type Polyline } from '../realtime/polyline'
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
  /** Height of the car floor and its halo. */
  y: number
}

/** Two reused ground points: the chord ends of the car being written. */
export interface ConsistScratch {
  a: Ground
  b: Ground
}

export function createConsistScratch(): ConsistScratch {
  return { a: { x: 0, z: 0 }, b: { x: 0, z: 0 } }
}

/**
 * Writes one train's car bodies and halos at instances `slot * MAX_CARS + c`. The cars are laid end to end
 * along `line` around the consist center, each at its chord's midpoint facing along the chord, so a curve
 * bends the train and no car leaves the line. `mix * k` (each 0..1) scales spacing and car length around the
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
    const pitch = Math.min(consist.pitchM, line.length / n)
    const step = pitch * u
    const rear = consistCenter(line.length, shown, n * step) - (n * step) / 2
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
    for (let c = 0; c < n; c++) {
      pointAtDistanceInto(line, rear + (c + 1) * step, b)
      const ux = b.x - a.x
      const uz = b.z - a.z
      const mx = (a.x + b.x) / 2
      const mz = (a.z + b.z) / 2
      writeYawMatrix(bodies, base + c, mx, frame.y, mz, ux, uz, cross, height, bodyLength)
      writeYawMatrix(halos, base + c, mx, frame.y, mz, ux, uz, haloWidth, 1, haloLength)
      const t = a
      a = b
      b = t
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
