/**
 * The platform decks of a station interior and the stroke bands they cut it into, so each deck's lifted trains draw
 * over that deck's strokes and under every level above it (2q7.28). Pure. `.ts` import paths:
 * scripts/lib/stationOutputs.test.ts (nodenext) loads interiorGeometry.ts, which imports this file.
 */
import type { StopId } from '../data/schema.ts'
import type { StationInterior } from '../data/stationSchema.ts'
import { CAR_FLOOR_M, CAR_HEIGHT_M } from './carDims.ts'

/** Decks the renderer lifts trains for (each costs a line pair and a set of above-veil car meshes). */
export const MAX_DECKS = 3

/**
 * Drawn y (group-local, before the depth factor) of a lifted train's roof on the platform at `level`: its rail
 * (`yScale` exaggerated like the interior) plus the car's floor and body height (real meters: cars aren't
 * exaggerated). At full tilt and crossScale 1, as at the interior's zoom, for an unselected car: the selected one
 * (widened, lifted 0.2 m) rises about 0.5 m above it, so a stair foot can touch its roof by a pixel or two. A stair foot
 * on the camera side of a car is hidden by it too: strokes have no depth test, so the cut is by height alone.
 */
export function trainRoofY(level: { y: number }, railDrop: number, yScale: number): number {
  return (level.y - railDrop) * yScale + CAR_FLOOR_M + CAR_HEIGHT_M
}

/**
 * Indices into `interior.levels` of the levels with a platform track (the decks lifted trains ride), deepest first.
 * Levels run highest first, so that is descending index. Over MAX_DECKS it keeps the shallowest MAX_DECKS (a deeper
 * deck's strokes and trains then share the deepest kept deck's band) and warns once per station.
 */
export function interiorDecks(interior: StationInterior): number[] {
  const decks: number[] = []
  for (let i = interior.levels.length - 1; i >= 0; i--) {
    const id = interior.levels[i]!.id
    if (interior.platforms.some((p) => p.level === id && p.tracks.length > 0)) decks.push(i)
  }
  if (decks.length <= MAX_DECKS) return decks
  warnTooManyDecks(interior.stationId, decks.length)
  return decks.slice(-MAX_DECKS)
}

const warned = new Set<string>()
function warnTooManyDecks(id: string, n: number): void {
  if (warned.has(id)) return
  warned.add(id)
  console.warn(`Interior ${id} has platform tracks on ${n} levels; only the shallowest ${MAX_DECKS} lift their trains apart`)
}

/**
 * The stroke band of the level at `levelIndex`: how many decks are deeper than it. Band j holds deck j (`decks` is
 * deepest first) and the levels between it and the deck below; deck j's lifted trains draw right after band j. With
 * no decks everything is band 0; with one, band 0 is the deck and below, band 1 the levels above it.
 */
export function strokeBandOf(levelIndex: number, decks: readonly number[]): number {
  let band = 0
  for (const d of decks) if (d > levelIndex) band++
  return band
}

/**
 * Where a connector crossing bands is cut, drawn y (group-local, before the depth factor): cut j, between band j and
 * band j + 1, is deck j's train roof. Rising with j while the decks are more than about a meter apart (all shipped ones).
 */
export function bandCutYs(interior: StationInterior, decks: readonly number[], railDrop: number, yScale: number): number[] {
  return decks.map((d) => trainRoofY(interior.levels[d]!, railDrop, yScale))
}

/** Each platform track's deck, by its stop id: the stroke band of its platform's level (its index in `decks`). */
export function trackDecks(interior: StationInterior, decks: readonly number[]): Map<StopId, number> {
  const levelIndex = new Map(interior.levels.map((l, i) => [l.id, i]))
  const out = new Map<StopId, number>()
  for (const p of interior.platforms) {
    const i = levelIndex.get(p.level)
    if (i === undefined) throw new Error(`Unknown level "${p.level}" in ${p.id}`)
    for (const t of p.tracks) out.set(t.stopId, strokeBandOf(i, decks))
  }
  return out
}
