/** Where each kept elevator and escalator lands: an `at` override (or none, to sit exactly on its entrance)
 *  inside the slab and platform of each of its non-street levels. Pure. */
import { ELEVATOR_WIDTH_M, ESCALATOR_WIDTH_M } from '../stationEquipment.ts'
import type { EquipmentOverride, FramePoint } from '../stationInputs.ts'
import { centerAt, dist, onPlatform, roundUV, searchCenterline } from './context.ts'
import type { PlatformGeom, TemplateCtx } from './context.ts'
import type { MachinePlan, PlanEntrance } from './machines.ts'
import { inSlab, nearestInSlab, nearestSlab, slabCenter } from './slabs.ts'
import type { SlabPlan } from './slabs.ts'

/** Machines drawn farther than this from the entrance that lists them get an UNVERIFIED note. */
export const FAR_FROM_ENTRANCE_M = 15
/** Clear gap between neighboring machines of one bank. */
export const BANK_GAP_M = 0.3
const MAX_BANK_SLOTS = 8
const INSET_M = 0.5

export interface MachineSites {
  slabs: readonly SlabPlan[]
  /** Platform serving each direction (the same one at an island). */
  platformFor: Record<'N' | 'S', PlatformGeom>
}

/** `p` when it is on the platform; else the nearest polygon edge point moved 0.5 m in toward the centerline;
 *  else a centerline search from p's u. */
function nearestOnPlatform(platform: PlatformGeom, p: FramePoint): FramePoint | null {
  if (onPlatform(platform, p)) return p
  let best: FramePoint | null = null
  for (const w of platform.ways) {
    for (let i = 0; i < w.ring.length; i++) {
      const a = w.ring[i]!
      const b = w.ring[(i + 1) % w.ring.length]!
      const [du, dv] = [b[0] - a[0], b[1] - a[1]]
      const len2 = du * du + dv * dv
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * du + (p[1] - a[1]) * dv) / len2))
      const q: FramePoint = [a[0] + t * du, a[1] + t * dv]
      if (!best || dist(q, p) < dist(best, p)) best = q
    }
  }
  const mid = best ? centerAt(platform, best[0]) : null
  if (best && mid !== null) {
    const inward: FramePoint = [best[0], best[1] + Math.sign(mid - best[1]) * INSET_M]
    if (onPlatform(platform, inward)) return inward
  }
  return searchCenterline(platform, p[0])
}

interface Site {
  /** Machines with the same key form one bank. */
  key: string
  base: FramePoint
  /** The base is the listing entrance's own point. */
  onEntrance: boolean
  fits: (p: FramePoint) => boolean
}

/** Offsets of a bank's slots: along u first (0, +1, -1, +2, ...), then across. */
function slotOffsets(step: number): FramePoint[] {
  const out: FramePoint[] = [[0, 0]]
  for (let k = 1; k <= MAX_BANK_SLOTS; k++) out.push([k * step, 0], [-k * step, 0])
  for (let k = 1; k <= MAX_BANK_SLOTS; k++) out.push([0, k * step], [0, -k * step])
  return out
}

/**
 * One override per kept machine. A street-mezzanine machine sits at its entrance (moved into the nearest slab when
 * the entrance is outside it); a street-platform one on the platform point nearest its entrance; a
 * mezzanine-platform one at its slab's center on the platform centerline. A side platform is chosen by the serving
 * text's direction, else alternately. Machines with the same level pair at one site form a bank: the first takes
 * the site, the rest sit width + 0.3 m apart along u (else across), each inside its slab and on its platform.
 * Template-placed escalators carry `generated`, not `authored`, so the client would also bank any that touch
 * (escalatorBanks.ts); spacing them here keeps them apart. `notes` names machines drawn far from their entrance.
 */
export function machineOverrides(
  ctx: TemplateCtx,
  plans: readonly MachinePlan[],
  entrances: readonly PlanEntrance[],
  sites: MachineSites,
): { overrides: EquipmentOverride[]; notes: string[] } {
  const order: PlatformGeom[] = sites.platformFor.N === sites.platformFor.S ? [sites.platformFor.N] : [sites.platformFor.N, sites.platformFor.S]
  let alternate = 0
  const platformOf = (p: MachinePlan): PlatformGeom => (p.direction ? sites.platformFor[p.direction] : order[alternate++ % order.length]!)

  const siteOf = (plan: MachinePlan, entrance: PlanEntrance | undefined, ee: FramePoint): Site => {
    const pair = [...plan.kinds].sort().join('-')
    const toStreet = plan.kinds.includes('street')
    if (toStreet && !plan.kinds.includes('platform')) {
      const from = entrance?.at ?? ee
      const slab = nearestSlab(sites.slabs, from)
      if (!slab) throw new Error(`${plan.row.code}: no slab to land on`)
      const inside = inSlab(slab, from, INSET_M)
      return { key: `${pair}@${entrance?.id ?? slab.id}`, base: inside ? from : nearestInSlab(slab, from, 1), onEntrance: inside && entrance !== undefined, fits: (p) => inSlab(slab, p, INSET_M) }
    }
    const platform = platformOf(plan)
    if (toStreet) {
      const from = entrance?.at ?? ee
      const base = nearestOnPlatform(platform, from)
      if (!base) throw new Error(`${plan.row.code}: no point on platform ${platform.index + 1} to place it`)
      return { key: `${pair}@${entrance?.id ?? ''}/p${platform.index}`, base, onEntrance: entrance !== undefined && base === from, fits: (p) => onPlatform(platform, p) }
    }
    const slab = nearestSlab(sites.slabs, ee)
    if (!slab) throw new Error(`${plan.row.code}: no slab to land on`)
    const fits = (p: FramePoint): boolean => inSlab(slab, p, INSET_M) && onPlatform(platform, p)
    const base = searchCenterline(platform, slabCenter(slab)[0], fits)
    if (!base) throw new Error(`${plan.row.code}: ${slab.id} and platform ${platform.index + 1} share no point to place it`)
    return { key: `${pair}@${slab.id}/p${platform.index}`, base, onEntrance: false, fits }
  }

  const banks = new Map<string, { at: FramePoint; width: number }[]>()
  const notes: string[] = []
  const overrides = plans.map((plan): EquipmentOverride => {
    const { row } = plan
    const entrance = plan.entrance === undefined ? undefined : entrances[plan.entrance]!
    const site = siteOf(plan, entrance, ctx.uv(row.lat, row.lon))
    const width = row.kind === 'elevator' ? ELEVATOR_WIDTH_M : ESCALATOR_WIDTH_M
    const taken = banks.get(site.key) ?? []
    banks.set(site.key, taken)
    const step = Math.max(width, ...taken.map((t) => t.width)) + BANK_GAP_M
    const offset = slotOffsets(step).find(([du, dv]) => {
      const p: FramePoint = [site.base[0] + du, site.base[1] + dv]
      return site.fits(p) && taken.every((t) => dist(p, t.at) >= (width + t.width) / 2 + BANK_GAP_M - 1e-9)
    })
    if (!offset) throw new Error(`${row.code}: no room left at ${site.key}`)
    const at: FramePoint = [site.base[0] + offset[0], site.base[1] + offset[1]]
    taken.push({ at, width })
    const link = entrance ? { entrance: entrance.id } : {}
    if (entrance && dist(at, entrance.at) > FAR_FROM_ENTRANCE_M) notes.push(`${row.code} is drawn ${dist(at, entrance.at).toFixed(0)} m from its entrance ${entrance.id}`)
    // Exactly on its entrance: no `at`, so the merge copies the entrance point.
    if (site.onEntrance && offset[0] === 0 && offset[1] === 0) return { code: row.code, ...link }
    return { code: row.code, at: roundUV(at), ...link }
  })
  return { overrides, notes }
}
