/** Stairs: one from each street entrance down (or up, at an elevated station) to its slab or, without a
 *  mezzanine, to the nearer platform; and one from each slab to each platform. Pure. Ends are ordered by level
 *  height, so the same plan positions serve a subway (street on top) and an elevated station (street at the bottom). */
import type { Level } from '../../../src/data/stationSchema.ts'
import type { AuthoredConnector, AuthoredEnd, FramePoint } from '../stationInputs.ts'
import { centerAt, dist, onPlatform, roundUV, searchCenterline } from './context.ts'
import type { PlatformGeom, TemplateCtx } from './context.ts'
import { MACHINE_ENTRANCE_TYPES } from './machines.ts'
import type { PlanEntrance } from './machines.ts'
import { inSlab, slabCenter } from './slabs.ts'
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
const SLAB_INSET_M = 0.5
const STEP_M = 2

interface End {
  end: AuthoredEnd
  y: number
}

function connector(id: string, kind: AuthoredConnector['kind'], width: number, a: End, b: End): AuthoredConnector {
  const [lower, upper] = a.y < b.y ? [a, b] : [b, a]
  return { id, kind, width, lower: lower.end, upper: upper.end }
}

const clampTo = (lo: number, hi: number, x: number): number => Math.max(lo + SLAB_INSET_M, Math.min(hi - SLAB_INSET_M, x))

/** The landing on a slab: the entrance moved RUN_PER_RISE x rise toward the slab center and clamped inside; if
 *  that is under MIN_RUN_M from the entrance, the same run along u in either direction. */
function slabLanding(slab: SlabPlan, from: FramePoint, run: number): FramePoint | null {
  const c = slabCenter(slab)
  const d = dist(from, c)
  const dirs: FramePoint[] = [...(d > 1e-6 ? [[(c[0] - from[0]) / d, (c[1] - from[1]) / d] as FramePoint] : []), [1, 0], [-1, 0]]
  for (const [du, dv] of dirs) {
    const p: FramePoint = [clampTo(...slab.uRange, from[0] + du * run), clampTo(...slab.vRange, from[1] + dv * run)]
    if (dist(p, from) >= MIN_RUN_M) return roundUV(p)
  }
  return null
}

export interface StairLevels {
  street: Level
  mezzanine: Level | null
  platform: Level
}

/** One stair (a ramp for a Ramp row) per entrance that is not an elevator or escalator entrance. Throws when an
 *  entrance has nowhere to land; long runs go to `log`. */
export function streetStairs(
  ctx: TemplateCtx,
  entrances: readonly PlanEntrance[],
  slabs: readonly SlabPlan[],
  levels: StairLevels,
  log: string[],
): AuthoredConnector[] {
  return entrances.flatMap((e, i): AuthoredConnector[] => {
    if (MACHINE_ENTRANCE_TYPES.has(e.row.type)) return []
    const kind = e.row.type === 'Ramp' ? 'ramp' : 'stair'
    const street: End = { end: { entrance: e.id }, y: 0 }
    let landing: FramePoint | null
    let level: Level
    if (levels.mezzanine) {
      level = levels.mezzanine
      const slab = slabs.find((s) => s.entrances.includes(i))
      if (!slab) throw new Error(`entrance ${e.id} has no slab`)
      landing = slabLanding(slab, e.at, RUN_PER_RISE * Math.abs(level.y))
    } else {
      level = levels.platform
      const platform = [...ctx.platforms].sort((a, b) => Math.abs(a.centerV - e.at[1]) - Math.abs(b.centerV - e.at[1]))[0]!
      const mid = (platform.uRange[0] + platform.uRange[1]) / 2
      const run = RUN_PER_RISE * Math.abs(level.y)
      landing = searchCenterline(platform, e.at[0] + Math.sign(mid - e.at[0]) * run, (p) => dist(p, e.at) >= MIN_RUN_M)
    }
    if (!landing) throw new Error(`entrance ${e.id} (${e.row.type}): no landing at least ${MIN_RUN_M} m away on the ${level.id} level`)
    const run = dist(landing, e.at)
    if (run > LONG_RUN_M) log.push(`${ctx.stationId} ${e.id}: street stair runs ${run.toFixed(0)} m`)
    return [connector(`st-${e.id}`, kind, STREET_STAIR_WIDTH_M, street, { end: { level: level.id, at: landing }, y: level.y })]
  })
}

/** Plan ends of a slab-to-platform stair: the slab end just inside the slab edge facing the platform's middle,
 *  the platform end RUN_PER_RISE x rise further on along the platform centerline. Steps back into the slab, then
 *  tries the other edge, until both ends land. */
function levelRun(slab: SlabPlan, platform: PlatformGeom, run: number): { slabEnd: FramePoint; platformEnd: FramePoint } | null {
  const pmid = (platform.uRange[0] + platform.uRange[1]) / 2
  const d = Math.sign(pmid - slabCenter(slab)[0]) || 1
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
  const run = RUN_PER_RISE * Math.abs(platformLevel.y - mezzanine.y)
  const out: AuthoredConnector[] = []
  for (const platform of ctx.platforms) {
    let reached = false
    for (const slab of slabs) {
      const ends = levelRun(slab, platform, run)
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
