/** Entrance marks for the street layer: the street file's entrances the focused interior doesn't already draw. Pure. */
import type { StationStreets } from '../data/streetSchema'
import type { LineBuffers, Rgb } from './lineBuffers'
import type { Ground } from './projection'

/** The file's coordinates are integer decimeters. */
const DM_PER_M = 10
/** A street-file entrance and an interior entrance this close (scene ground, meters) and of one type are one entrance
 *  (the rule in streetSchema.ts). */
export const ENTRANCE_MATCH_M = 1.5

/** An interior's entrances in its own frame: meters from `origin`, its anchor's scene ground point. */
export interface InteriorEntrances {
  origin: Ground
  entrances: readonly { x: number; z: number; type: string }[]
}

/** The street file's entrance `i` in meters from the file's anchor. */
export function entranceLocal(file: StationStreets, i: number): Ground {
  const e = file.entrances[i]!
  return { x: e.x / DM_PER_M, z: e.z / DM_PER_M }
}

/**
 * Indexes of the street file's entrances (file anchored at `fileGround`) that no entrance of `interior` matches:
 * none within ENTRANCE_MATCH_M on the ground with the same type. With no interior, every entrance.
 */
export function unmatchedEntrances(file: StationStreets, fileGround: Ground, interior: InteriorEntrances | null): number[] {
  const out: number[] = []
  for (let i = 0; i < file.entrances.length; i++) {
    const e = file.entrances[i]!
    const p = entranceLocal(file, i)
    const x = fileGround.x + p.x
    const z = fileGround.z + p.z
    const matched = interior?.entrances.some(
      (d) => d.type === e.type && Math.hypot(interior.origin.x + d.x - x, interior.origin.z + d.z - z) <= ENTRANCE_MATCH_M,
    )
    if (!matched) out.push(i)
  }
  return out
}

/** A `size` m square at street level (y = 0) around each listed entrance, in meters from the file's anchor, as the
 *  interior draws its own entrances; every vertex colored `rgb` (linear). */
export function entranceMarkBuffers(file: StationStreets, indices: readonly number[], size: number, rgb: Rgb): LineBuffers {
  const positions = new Float32Array(indices.length * 4 * 6)
  const colors = new Float32Array(positions.length)
  const h = size / 2
  let o = 0
  for (const i of indices) {
    const { x, z } = entranceLocal(file, i)
    const corners = [
      [x - h, z - h],
      [x + h, z - h],
      [x + h, z + h],
      [x - h, z + h],
    ] as const
    for (let k = 0; k < 4; k++) {
      const a = corners[k]!
      const b = corners[(k + 1) % 4]!
      positions.set([a[0], 0, a[1], b[0], 0, b[1]], o)
      colors.set([...rgb, ...rgb], o)
      o += 6
    }
  }
  return { positions, colors }
}
