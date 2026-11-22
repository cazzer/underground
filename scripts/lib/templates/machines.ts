/** Elevators and escalators: which E&E rows the merge can take and which street entrance each street machine
 *  serves (placement is machineSites.ts). Pure. E&E lat/lon are unreliable (data/README.md): they only choose
 *  among candidate entrances and slabs. */
import type { LevelKind } from '../../../src/data/stationSchema.ts'
import type { CatalogStation } from '../catalogTypes.ts'
import type { EquipmentRow, EntranceRow, FramePoint } from '../stationInputs.ts'
import { parseServing } from '../stationSources.ts'
import { dist } from './context.ts'
import type { TemplateCtx } from './context.ts'

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
    if (row.serving === null) {
      dropped.push(`${row.code}: no serving text`)
      continue
    }
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

