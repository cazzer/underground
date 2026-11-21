/** Elevators and escalators: one connector per E&E row, placed and leveled from the serving text
 *  plus the authored per-machine overrides. */
import type { Connector, Entrance, Level } from '../../src/data/stationSchema.ts'
import { finite, list, oneOf, onlyKeys, pair, record, text } from './check.ts'
import type { Ctx } from './stationCtx.ts'
import { entranceOf, levelOf, srcs } from './stationCtx.ts'
import type { AuthoredStation, EquipmentRow, StationSources } from './stationInputs.ts'
import { parseServing } from './stationSources.ts'
import type { Serving } from './stationSources.ts'

/** Estimates: the E&E inventory has no shaft or escalator width. Override per machine. */
export const ELEVATOR_WIDTH_M = 2
export const ESCALATOR_WIDTH_M = 1.2
const OVERRIDE_KEYS = ['code', 'at', 'entrance', 'levels', 'width']

interface Override {
  at: string
  o: Record<string, unknown>
}

function overridesByCode(authored: AuthoredStation, rows: EquipmentRow[]): Map<string, Override> {
  const out = new Map<string, Override>()
  list(authored.equipment, 'equipment').forEach((raw, i) => {
    const at = `equipment[${i}]`
    const o = record(raw, at)
    onlyKeys(o, OVERRIDE_KEYS, at)
    const code = text(o.code, `${at}.code`)
    if (out.has(code)) throw new Error(`${at}.code: duplicate override for ${code}`)
    if (!rows.some((row) => row.code === code)) throw new Error(`${at}.code: no E&E row for ${JSON.stringify(code)}`)
    out.set(code, { at, o })
  })
  return out
}

/** The two levels a machine joins, ordered by elevation. An explicit `levels` override names
 *  them directly; otherwise each side of the serving text must match exactly one level kind. */
function machineLevels(ctx: Ctx, serving: Serving, o: Record<string, unknown>, at: string, servingText: string): [Level, Level] {
  let ends: [Level, Level]
  if (o.levels !== undefined) {
    const l = record(o.levels, `${at}.levels`)
    onlyKeys(l, ['lower', 'upper'], `${at}.levels`)
    ends = [levelOf(ctx, l.lower, `${at}.levels.lower`), levelOf(ctx, l.upper, `${at}.levels.upper`)]
  } else {
    const pick = (kind: Level['kind']): Level => {
      const found = [...ctx.levels.values()].filter((lv) => lv.kind === kind)
      if (found.length !== 1) throw new Error(`${at}: "${servingText}" -> ${found.length} ${kind} levels; add "levels" to the override`)
      return found[0]!
    }
    ends = [pick(serving.from), pick(serving.to)]
  }
  if (ends[0].y === ends[1].y) throw new Error(`${at}: "${servingText}" joins two levels at the same elevation`)
  return ends[0].y < ends[1].y ? ends : [ends[1], ends[0]]
}

/** Only when the text names one direction and the two level kinds tell it apart. */
function travelOf(serving: Serving, lower: Level, upper: Level): 'up' | 'down' | undefined {
  if (serving.bothDirections || lower.kind === upper.kind) return undefined
  if (serving.from === lower.kind && serving.to === upper.kind) return 'up'
  if (serving.from === upper.kind && serving.to === lower.kind) return 'down'
  return undefined
}

export function buildMachines(authored: AuthoredStation, sources: StationSources, ctx: Ctx, entrances: Map<string, Entrance>): Connector[] {
  const overrides = overridesByCode(authored, sources.equipment.rows)
  return sources.equipment.rows.map((row, i): Connector => {
    const rowAt = `sources.equipment.rows[${i}]`
    const code = text(row.code, `${rowAt}.code`)
    const kind = oneOf(row.kind, ['elevator', 'escalator'], `${rowAt}.kind`)
    const servingText = text(row.serving, `${rowAt}.serving`)
    const lat = finite(row.lat, `${rowAt}.lat`)
    const lon = finite(row.lon, `${rowAt}.lon`)
    const at = overrides.get(code)?.at ?? `equipment ${code}`
    const o = overrides.get(code)?.o ?? {}
    const serving = parseServing(servingText)
    const [lower, upper] = machineLevels(ctx, serving, o, at, servingText)
    const entrance = o.entrance === undefined ? undefined : entranceOf(entrances, o.entrance, `${at}.entrance`)
    if (entrance && upper.kind !== 'street') throw new Error(`${at}.entrance: ${code} does not reach the street (its upper level is ${upper.id})`)
    const [x, z] = o.at !== undefined ? ctx.frame.fromUV(pair(o.at, `${at}.at`)) : entrance ? [entrance.x, entrance.z] : ctx.frame.fromLatLon(lat, lon)
    entrance?.connectors.push(code)
    const width = o.width === undefined ? (kind === 'elevator' ? ELEVATOR_WIDTH_M : ESCALATOR_WIDTH_M) : finite(o.width, `${at}.width`)
    if (width <= 0) throw new Error(`${at}.width: must be > 0, got ${width}`)
    const travel = kind === 'escalator' ? travelOf(serving, lower, upper) : undefined
    return {
      id: code,
      kind,
      // The inventory gives one point per machine, so both ends share x/z.
      lower: { x, z, level: lower.id },
      upper: { x, z, level: upper.id },
      width,
      ...(travel ? { travel } : {}),
      sources: srcs('nyopendata', ...(o.at !== undefined ? (['authored'] as const) : [])),
    }
  })
}
