/** Elevators and escalators: which E&E rows the merge can take, which street entrance each street machine
 *  serves, and an `at` override for every machine that lands it on each of its non-street levels. Pure.
 *  E&E lat/lon are unreliable (data/README.md): they only choose among candidate entrances and slabs. */
import type { LevelKind } from '../../../src/data/stationSchema.ts'
import type { CatalogStation } from '../catalogTypes.ts'
import type { EquipmentOverride, EquipmentRow, EntranceRow, FramePoint } from '../stationInputs.ts'
import { parseServing } from '../stationSources.ts'
import { dist, roundUV, searchCenterline } from './context.ts'
import type { PlatformGeom, TemplateCtx } from './context.ts'
import { inSlab, slabCenter } from './slabs.ts'
import type { SlabPlan } from './slabs.ts'

/** Machines sharing a slab and platform start this far apart along the platform. */
export const MACHINE_SPACING_M = 2.5
const ENTRANCE_TYPES: Record<EquipmentRow['kind'], readonly string[]> = {
  elevator: ['Elevator'],
  escalator: ['Escalator', 'Stair/Escalator'],
}
/** Entrance types that must be served by a machine of the same kind (checkEntranceLinks). */
export const MACHINE_ENTRANCE_TYPES = new Set(['Elevator', 'Escalator'])

export interface PlanEntrance {
  id: string
  row: EntranceRow
  at: FramePoint
}

export interface MachinePlan {
  row: EquipmentRow
  kinds: [LevelKind, LevelKind]
  /** Index into the entrance list. */
  entrance?: number
  direction?: 'N' | 'S'
}

/** The direction a serving text names: uptown/downtown, north/southbound, or the station's own direction labels. */
export function directionOf(serving: string, row: Pick<CatalogStation, 'northLabel' | 'southLabel'>): 'N' | 'S' | undefined {
  const s = serving.toLowerCase()
  if (/both directions|all directions/.test(s)) return undefined
  const label = (l: string): string | null => {
    const t = l.trim().toLowerCase()
    return t === '' || t === 'last stop' ? null : t
  }
  const north = /\buptown\b|\bnorthbound\b/.test(s) || (label(row.northLabel) !== null && s.includes(label(row.northLabel)!))
  const south = /\bdowntown\b|\bsouthbound\b/.test(s) || (label(row.southLabel) !== null && s.includes(label(row.southLabel)!))
  return north === south ? undefined : north ? 'N' : 'S'
}

/** Keeps the rows whose serving text names two different levels this station has, and links each street machine
 *  to the nearest entrance of its kind (unused ones first). Everything else is dropped with a reason. */
export function planMachines(
  ctx: TemplateCtx,
  rows: readonly EquipmentRow[],
  entrances: readonly PlanEntrance[],
  levelKinds: ReadonlySet<LevelKind>,
): { plans: MachinePlan[]; dropped: string[] } {
  const plans: MachinePlan[] = []
  const dropped: string[] = []
  const used = new Set<number>()
  for (const row of rows) {
    let kinds: [LevelKind, LevelKind]
    try {
      const s = parseServing(row.serving)
      kinds = [s.from, s.to]
    } catch (err) {
      dropped.push(`${row.code}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    if (kinds[0] === kinds[1]) {
      dropped.push(`${row.code}: joins ${kinds[0]} to ${kinds[1]} ("${row.serving}")`)
      continue
    }
    const missing = kinds.find((k) => !levelKinds.has(k))
    if (missing) {
      dropped.push(`${row.code}: this template has no ${missing} level ("${row.serving}")`)
      continue
    }
    const plan: MachinePlan = { row, kinds }
    const dir = directionOf(row.serving, ctx.row)
    if (dir) plan.direction = dir
    if (kinds.includes('street')) {
      const ee = ctx.uv(row.lat, row.lon)
      const fits = entrances.map((e, i) => ({ e, i })).filter(({ e }) => ENTRANCE_TYPES[row.kind].includes(e.row.type))
      const pick = (pool: typeof fits) => [...pool].sort((a, b) => dist(a.e.at, ee) - dist(b.e.at, ee) || a.i - b.i)[0]
      const best = pick(fits.filter(({ i }) => !used.has(i))) ?? pick(fits)
      if (best) {
        plan.entrance = best.i
        used.add(best.i)
      }
    }
    plans.push(plan)
  }
  return { plans, dropped }
}

export interface MachineSites {
  slabs: readonly SlabPlan[]
  /** Platform serving each direction (the same one at an island). */
  platformFor: Record<'N' | 'S', PlatformGeom>
}

function nearestSlab(slabs: readonly SlabPlan[], p: FramePoint): SlabPlan {
  return [...slabs].sort((a, b) => dist(slabCenter(a), p) - dist(slabCenter(b), p))[0]!
}

/** One override per kept machine, landing it on each of its non-street levels: a street machine with an entrance
 *  sits at it (street to mezzanine; slabs contain such entrances) or on the nearest platform point (street to
 *  platform); a mezzanine-platform machine sits at its slab's center on the platform centerline, MACHINE_SPACING_M
 *  apart. A side platform is chosen by the serving text's direction, else alternately. */
export function machineOverrides(ctx: TemplateCtx, plans: readonly MachinePlan[], entrances: readonly PlanEntrance[], sites: MachineSites): EquipmentOverride[] {
  const order: PlatformGeom[] = sites.platformFor.N === sites.platformFor.S ? [sites.platformFor.N] : [sites.platformFor.N, sites.platformFor.S]
  let alternate = 0
  const platformOf = (p: MachinePlan): PlatformGeom => (p.direction ? sites.platformFor[p.direction] : order[alternate++ % order.length]!)
  const perPair = new Map<string, number>()
  return plans.map((plan): EquipmentOverride => {
    const { row } = plan
    const ee = ctx.uv(row.lat, row.lon)
    const entrance = plan.entrance === undefined ? undefined : entrances[plan.entrance]!
    const link = entrance ? { entrance: entrance.id } : {}
    const toStreet = plan.kinds.includes('street')
    const toPlatform = plan.kinds.includes('platform')
    if (toStreet && !toPlatform) {
      // No `at`: the merge then puts it exactly on the entrance point (slabs contain such entrances).
      if (entrance) return { code: row.code, ...link }
      const slab = nearestSlab(sites.slabs, ee)
      const inset = (lo: number, hi: number, x: number): number => Math.max(lo + 1, Math.min(hi - 1, x))
      return { code: row.code, at: roundUV([inset(...slab.uRange, ee[0]), inset(...slab.vRange, ee[1])]) }
    }
    const platform = platformOf(plan)
    if (toStreet) {
      const from = entrance?.at ?? ee
      const at = searchCenterline(platform, from[0])
      if (!at) throw new Error(`${row.code}: no point on platform ${platform.index} to place it`)
      return { code: row.code, at, ...link }
    }
    const slab = nearestSlab(sites.slabs, ee)
    const key = `${slab.id}/${platform.index}`
    const k = perPair.get(key) ?? 0
    perPair.set(key, k + 1)
    const at = searchCenterline(platform, slabCenter(slab)[0] + k * MACHINE_SPACING_M, (p) => inSlab(slab, p, 0.5))
    if (!at) throw new Error(`${row.code}: ${slab.id} and platform ${platform.index} share no point to place it`)
    return { code: row.code, at }
  })
}
