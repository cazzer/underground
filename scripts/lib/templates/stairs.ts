/** Stairs: one from each street entrance down (or up, at an elevated station) to its slab or, without a
 *  mezzanine, to the nearer platform (then a coverage pass gives any platform no stair or machine reaches one
 *  from the nearest entrance that doesn't cross another platform); and one from each slab to each platform. Pure. Ends are ordered by level
 *  height, so the same plan positions serve a subway (street on top) and an elevated station (street at the bottom). */
import type { Level } from '../../../src/data/stationSchema.ts'
import { distanceToRing } from '../stationGeometry.ts'
import type { AuthoredConnector, AuthoredEnd, FramePoint } from '../stationInputs.ts'
import { centerAt, dist, nearestOnPlatform, onPlatform, roundUV, searchCenterline } from './context.ts'
import type { PlatformGeom, TemplateCtx } from './context.ts'
import { MACHINE_ENTRANCE_TYPES } from './machines.ts'
import type { PlanEntrance } from './machines.ts'
import { inSlab, nearestInSlab, nearestSlab, slabCenter } from './slabs.ts'
import type { SlabPlan } from './slabs.ts'

/** Plan run per meter of rise (about a 32 degree stair). */
export const RUN_PER_RISE = 1.6
/** A stair shorter than this in plan has no direction to draw. */
export const MIN_RUN_M = 3
/** Street stairs longer than this are logged: the entrance is far from its slab. */
export const LONG_RUN_M = 40
export const STREET_STAIR_WIDTH_M = 1.5
export const ISLAND_STAIR_WIDTH_M = 2.4
export const SIDE_STAIR_WIDTH_M = 1.8
/** The interior's default vertical exaggeration (`?interiorY=2`, src/scene/interiorLook.ts). */
export const DRAWN_Y_SCALE = 2
export const SLAB_INSET_M = 0.5
const STEP_M = 2

interface End {
  end: AuthoredEnd
  y: number
}

function connector(id: string, kind: AuthoredConnector['kind'], width: number, a: End, b: End): AuthoredConnector {
  const [lower, upper] = a.y < b.y ? [a, b] : [b, a]
  return { id, kind, width, lower: lower.end, upper: upper.end }
}

/** A street stair's plan run is at most this, or RUN_PER_RISE x rise when that is longer. Entrances farther
 *  than that from every slab or platform are dropped before the stairs are built (build.ts). */
export const MAX_STREET_RUN_M = 20
/** Two street stairs never land closer than this (center to center): one landing, one stair. */
const LANDING_GAP_M = STREET_STAIR_WIDTH_M + 0.3
const SEARCH_STEP_M = 0.5

export const maxStreetRun = (riseM: number): number => Math.max(MAX_STREET_RUN_M, RUN_PER_RISE * Math.abs(riseM))

const unit = (from: FramePoint, to: FramePoint): FramePoint | null => {
  const d = dist(from, to)
  return d < 1e-6 ? null : [(to[0] - from[0]) / d, (to[1] - from[1]) / d]
}

/** The landing on a slab: along the line from the entrance toward the slab center (then toward its nearest
 *  point, then along either way of u), the first point inside the slab at a run between RUN_PER_RISE x rise
 *  (at least MIN_RUN_M) and the cap that is clear of the landings already taken. */
function slabLanding(slab: SlabPlan, from: FramePoint, minRun: number, maxRun: number, free: (p: FramePoint) => boolean): FramePoint | null {
  const dirs = [unit(from, slabCenter(slab)), unit(from, nearestInSlab(slab, from, SLAB_INSET_M)), [1, 0] as FramePoint, [-1, 0] as FramePoint]
  for (const lo of [minRun, MIN_RUN_M]) {
    for (const dir of dirs) {
      if (!dir) continue
      for (let s = lo; s <= maxRun + 1e-9; s += SEARCH_STEP_M) {
        const p: FramePoint = [from[0] + dir[0] * s, from[1] + dir[1] * s]
        if (inSlab(slab, p, SLAB_INSET_M) && free(p)) return roundUV(p)
      }
    }
  }
  return null
}

export interface StairLevels {
  street: Level
  mezzanine: Level | null
  platform: Level
}

/** The platform a street stair goes to without a mezzanine: the one nearest the entrance across the tracks. */
export const nearerPlatform = (ctx: TemplateCtx, at: FramePoint): PlatformGeom =>
  [...ctx.platforms].sort((a, b) => Math.abs(a.centerV - at[1]) - Math.abs(b.centerV - at[1]) || a.index - b.index)[0]!

/** One stair (a ramp for a Ramp row) per entrance that is not an elevator or escalator entrance, landing on the
 *  nearest slab (or the nearer platform) no farther than maxStreetRun, never on another stair's landing.
 *  Entrances with nowhere to land are returned in `unplaced`; runs over LONG_RUN_M go to `log`.
 *  Without a mezzanine every platform that carries a track (`tracked`) must end up reached, by one of these
 *  stairs or by a machine (`machinePlatforms`): `coverPlatforms` adds the missing ones (named in `covered`, for
 *  the caller to log once) and throws when it can't. */
export function streetStairs(
  ctx: TemplateCtx,
  entrances: readonly PlanEntrance[],
  slabs: readonly SlabPlan[],
  levels: StairLevels,
  log: string[],
  machinePlatforms: ReadonlySet<number>,
  tracked: ReadonlySet<number>,
): { connectors: AuthoredConnector[]; unplaced: PlanEntrance[]; covered: string[] } {
  const taken: FramePoint[] = []
  const unplaced: PlanEntrance[] = []
  const reached = new Set(machinePlatforms)
  const free = (p: FramePoint): boolean => taken.every((q) => dist(p, q) >= LANDING_GAP_M)
  const connectors = entrances.flatMap((e): AuthoredConnector[] => {
    if (MACHINE_ENTRANCE_TYPES.has(e.row.type)) return []
    const kind = e.row.type === 'Ramp' ? 'ramp' : 'stair'
    const street: End = { end: { entrance: e.id }, y: 0 }
    const level = levels.mezzanine ?? levels.platform
    const minRun = Math.max(MIN_RUN_M, RUN_PER_RISE * Math.abs(level.y))
    const maxRun = maxStreetRun(level.y)
    let landing: FramePoint | null
    if (levels.mezzanine) {
      const slab = nearestSlab(slabs, e.at)
      if (!slab) throw new Error(`entrance ${e.id} has no slab`)
      landing = slabLanding(slab, e.at, minRun, maxRun, free)
    } else {
      const platform = nearerPlatform(ctx, e.at)
      const mid = (platform.uRange[0] + platform.uRange[1]) / 2
      const ok = (p: FramePoint): boolean => dist(p, e.at) >= MIN_RUN_M && dist(p, e.at) <= maxRun && free(p)
      landing = searchCenterline(platform, e.at[0] + Math.sign(mid - e.at[0]) * minRun, ok)
      if (landing) reached.add(platform.index)
    }
    if (!landing) {
      unplaced.push(e)
      return []
    }
    taken.push(landing)
    const run = dist(landing, e.at)
    if (run > LONG_RUN_M) log.push(`${ctx.stationId} ${e.id}: street stair runs ${run.toFixed(0)} m`)
    return [connector(`st-${e.id}`, kind, STREET_STAIR_WIDTH_M, street, { end: { level: level.id, at: landing }, y: level.y })]
  })
  const covered: string[] = []
  if (!levels.mezzanine) {
    const needed = ctx.platforms.filter((p) => tracked.has(p.index) && !reached.has(p.index))
    connectors.push(...coverPlatforms(ctx, needed, entrances, levels.platform, unplaced, { taken, free }, covered))
  }
  return { connectors, unplaced, covered }
}

/** A stair to each of the `needed` platforms, from the nearest non-machine entrance (even one the main pass left
 *  unplaced) that does not cross another platform: no other platform's center line lies strictly between the
 *  entrance and this platform's. (The test is on center lines, so an entrance between the two platforms' center
 *  lines, over the trackway, may serve both.) It lands on the platform's centerline, else at its nearest edge point
 *  moved 0.5 m in. A rescued entrance leaves `unplaced` and keeps the `st-<id>` id; an entrance that already has a
 *  stair gets `st-<id>-p<n>`. Throws when no entrance lands. */
function coverPlatforms(
  ctx: TemplateCtx,
  needed: readonly PlatformGeom[],
  entrances: readonly PlanEntrance[],
  level: Level,
  unplaced: PlanEntrance[],
  landings: { taken: FramePoint[]; free: (p: FramePoint) => boolean },
  covered: string[],
): AuthoredConnector[] {
  const minRun = Math.max(MIN_RUN_M, RUN_PER_RISE * Math.abs(level.y))
  const maxRun = maxStreetRun(level.y)
  const out: AuthoredConnector[] = []
  for (const platform of needed) {
    const crosses = (at: FramePoint): boolean => ctx.platforms.some((q) => q !== platform && (q.centerV - at[1]) * (q.centerV - platform.centerV) < 0)
    const toRing = (at: FramePoint): number => Math.min(...platform.ways.map((w) => distanceToRing(at, w.ring)))
    const pool = entrances
      .filter((e) => !MACHINE_ENTRANCE_TYPES.has(e.row.type) && !crosses(e.at))
      .map((e) => ({ e, away: toRing(e.at) }))
      .sort((a, b) => a.away - b.away || (a.e.id < b.e.id ? -1 : 1))
    const mid = (platform.uRange[0] + platform.uRange[1]) / 2
    let landed: { e: PlanEntrance; landing: FramePoint } | null = null
    for (const { e } of pool) {
      const ok = (p: FramePoint): boolean => dist(p, e.at) >= MIN_RUN_M && dist(p, e.at) <= maxRun && landings.free(p)
      const landing = searchCenterline(platform, e.at[0] + Math.sign(mid - e.at[0]) * minRun, ok) ?? edgeLanding(platform, e.at, minRun, ok)
      if (landing) {
        landed = { e, landing }
        break
      }
    }
    if (!landed) throw new Error(`platform ${platform.index + 1}: no street stair reaches it within ${maxRun.toFixed(0)} m`)
    const { e, landing } = landed
    landings.taken.push(landing)
    const rescued = unplaced.indexOf(e)
    if (rescued >= 0) unplaced.splice(rescued, 1)
    const id = rescued >= 0 ? `st-${e.id}` : `st-${e.id}-p${platform.index + 1}`
    covered.push(`${ctx.stationId} ${id}: added so platform ${platform.index + 1} has a stair`)
    const kind = e.row.type === 'Ramp' ? 'ramp' : 'stair'
    out.push(connector(id, kind, STREET_STAIR_WIDTH_M, { end: { entrance: e.id }, y: 0 }, { end: { level: level.id, at: landing }, y: level.y }))
  }
  return out
}

/** The platform's nearest edge point to the entrance, moved 0.5 m in and rounded, when its run is at least `minRun`
 *  (RUN_PER_RISE x the rise, as for the main pass's search) and `ok` takes it. */
function edgeLanding(platform: PlatformGeom, from: FramePoint, minRun: number, ok: (p: FramePoint) => boolean): FramePoint | null {
  const edge = nearestOnPlatform(platform, from)
  if (!edge) return null
  const landing = roundUV(edge)
  return dist(landing, from) >= minRun && ok(landing) ? landing : null
}

/** Plan ends of a slab-to-platform stair: the slab end just inside the slab edge facing direction `d`,
 *  the platform end RUN_PER_RISE x rise further on along the platform centerline. Steps back into the slab, then
 *  tries the other edge, until both ends land. */
function levelRun(slab: SlabPlan, platform: PlatformGeom, run: number, d: 1 | -1): { slabEnd: FramePoint; platformEnd: FramePoint } | null {
  for (const dir of [d, -d]) {
    const edge = dir > 0 ? slab.uRange[1] : slab.uRange[0]
    for (let k = 0; ; k++) {
      const u = edge - dir * (1 + STEP_M * k)
      if (u < slab.uRange[0] + SLAB_INSET_M || u > slab.uRange[1] - SLAB_INSET_M) break
      const v = centerAt(platform, u + dir * run)
      if (v === null) continue
      const slabEnd: FramePoint = [u, v]
      const platformEnd: FramePoint = [u + dir * run, v]
      if (inSlab(slab, slabEnd, SLAB_INSET_M) && onPlatform(platform, platformEnd)) return { slabEnd: roundUV(slabEnd), platformEnd: roundUV(platformEnd) }
    }
  }
  return null
}

/** One stair from each slab to each platform it can reach; throws when a platform is reached by none. */
export function levelStairs(ctx: TemplateCtx, slabs: readonly SlabPlan[], mezzanine: Level, platformLevel: Level): AuthoredConnector[] {
  // Sized for the drawn rise (the renderer exaggerates y), so the stair stays under about 40 degrees as drawn.
  const run = RUN_PER_RISE * DRAWN_Y_SCALE * Math.abs(platformLevel.y - mezzanine.y)
  const out: AuthoredConnector[] = []
  for (const platform of ctx.platforms) {
    let reached = false
    for (const slab of slabs) {
      // One direction per slab, toward the middle of all the platforms, so its stairs run side by side, never in an X.
      const d = Math.sign((ctx.uSpan[0] + ctx.uSpan[1]) / 2 - slabCenter(slab)[0]) || 1
      const ends = levelRun(slab, platform, run, d as 1 | -1)
      if (!ends) continue
      reached = true
      const width = platform.kind === 'island' ? ISLAND_STAIR_WIDTH_M : SIDE_STAIR_WIDTH_M
      out.push(connector(`st-${slab.id}-p${platform.index + 1}`, 'stair', width,
        { end: { level: mezzanine.id, at: ends.slabEnd }, y: mezzanine.y },
        { end: { level: platformLevel.id, at: ends.platformEnd }, y: platformLevel.y }))
    }
    if (!reached) throw new Error(`platform ${platform.index + 1}: no slab reaches it with a ${run.toFixed(1)} m stair`)
  }
  return out
}
