/** Elevators and escalators: one connector per E&E row, placed and leveled from the serving text
 *  plus the authored per-machine overrides. */
import type { Connector, Entrance, Level } from '../../src/data/stationSchema.ts'
import { finite, list, oneOf, onlyKeys, pair, record, text } from './check.ts'
import type { Ctx } from './stationCtx.ts'
import { entranceOf, levelOf, srcs } from './stationCtx.ts'
import type { AuthoredStation, EquipmentRow, StationSources } from './stationInputs.ts'
import { checkOsmRef } from './stationOsmRef.ts'
import { parseServing, parseServingLenient } from './stationSources.ts'
import type { Serving } from './stationSources.ts'

/** Estimates: the E&E inventory has no shaft or escalator width. Override per machine. */
export const ELEVATOR_WIDTH_M = 2
export const ESCALATOR_WIDTH_M = 1.2
const OVERRIDE_KEYS = ['code', 'at', 'ends', 'entrance', 'levels', 'width', 'osmRef']

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
function machineLevels(ctx: Ctx, serving: Serving | null, o: Record<string, unknown>, at: string, servingText: string): [Level, Level] {
  let ends: [Level, Level]
  if (o.levels !== undefined) {
    const l = record(o.levels, `${at}.levels`)
    onlyKeys(l, ['lower', 'upper'], `${at}.levels`)
    ends = [levelOf(ctx, l.lower, `${at}.levels.lower`), levelOf(ctx, l.upper, `${at}.levels.upper`)]
  } else {
    if (serving === null) throw new Error(`${at}: no serving text to read levels from; add "levels" to the override`)
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
function travelOf(serving: Serving | null, lower: Level, upper: Level): 'up' | 'down' | undefined {
  if (serving === null || serving.bothDirections || lower.kind === upper.kind) return undefined
  if (serving.from === lower.kind && serving.to === upper.kind) return 'up'
  if (serving.from === upper.kind && serving.to === lower.kind) return 'down'
  return undefined
}

/** An escalator's own plan run (`ends`, frame points by elevation). Its street end, when it has an entrance,
 *  sits exactly on the entrance point. Not with `at`, and not for elevators (their shaft is one point). */
function runEnds(ctx: Ctx, o: Record<string, unknown>, at: string, kind: string, lower: Level, upper: Level, entrance: Entrance | undefined): { lower: [number, number]; upper: [number, number] } {
  if (kind !== 'escalator') throw new Error(`${at}.ends: only an escalator has a run`)
  if (o.at !== undefined) throw new Error(`${at}: give either "at" or "ends", not both`)
  const e = record(o.ends, `${at}.ends`)
  onlyKeys(e, ['lower', 'upper'], `${at}.ends`)
  const end = (role: 'lower' | 'upper', level: Level): [number, number] =>
    entrance && level.kind === 'street' ? [entrance.x, entrance.z] : ctx.frame.fromUV(pair(e[role], `${at}.ends.${role}`))
  return { lower: end('lower', lower), upper: end('upper', upper) }
}

function noServing(at: string): never {
  throw new Error(`${at}: the E&E row has no serving text; add "levels" to the override`)
}

/** The machine's authored points an `osmRef` is checked against: its `at`, or the ends of its own run, an end pinned
 *  to its entrance left out. A machine placed by E&E lat/lon or by its entrance has none, and an `osmRef` fails. */
function authoredPoints(o: Record<string, unknown>, ends: { lower: [number, number]; upper: [number, number] } | undefined, lower: Level, upper: Level, entrance: Entrance | undefined, at: [number, number]): [number, number][] {
  if (o.at !== undefined) return [at]
  if (!ends) return []
  return [
    ...(entrance && lower.kind === 'street' ? [] : [ends.lower]),
    ...(entrance && upper.kind === 'street' ? [] : [ends.upper]),
  ]
}

export function buildMachines(authored: AuthoredStation, sources: StationSources, ctx: Ctx, entrances: Map<string, Entrance>): Connector[] {
  const overrides = overridesByCode(authored, sources.equipment.rows)
  return sources.equipment.rows.map((row, i): Connector => {
    const rowAt = `sources.equipment.rows[${i}]`
    const code = text(row.code, `${rowAt}.code`)
    const kind = oneOf(row.kind, ['elevator', 'escalator'], `${rowAt}.kind`)
    const servingText = row.serving === null ? null : text(row.serving, `${rowAt}.serving`)
    const lat = finite(row.lat, `${rowAt}.lat`)
    const lon = finite(row.lon, `${rowAt}.lon`)
    const at = overrides.get(code)?.at ?? `equipment ${code}`
    const o = overrides.get(code)?.o ?? {}
    // With a `levels` override the serving text only gives the direction, so an odd or missing one is accepted.
    // Without it the text is the levels' only source: strict, and required.
    const serving = o.levels !== undefined ? (servingText === null ? null : parseServingLenient(servingText)) : parseServing(servingText ?? noServing(at))
    const [lower, upper] = machineLevels(ctx, serving, o, at, servingText ?? '(none)')
    const entrance = o.entrance === undefined ? undefined : entranceOf(entrances, o.entrance, `${at}.entrance`)
    // The street end is the upper one below ground and the lower one at an elevated station.
    if (entrance && upper.kind !== 'street' && lower.kind !== 'street') {
      throw new Error(`${at}.entrance: ${code} does not reach the street (it joins ${lower.id} and ${upper.id})`)
    }
    const [x, z] = o.at !== undefined ? ctx.frame.fromUV(pair(o.at, `${at}.at`)) : entrance ? [entrance.x, entrance.z] : ctx.frame.fromLatLon(lat, lon)
    const ends = o.ends === undefined ? undefined : runEnds(ctx, o, at, kind, lower, upper, entrance)
    const osmRef = o.osmRef === undefined ? undefined : checkOsmRef(ctx, sources, o.osmRef, authoredPoints(o, ends, lower, upper, entrance, [x, z]), `${at}.osmRef`)
    entrance?.connectors.push(code)
    const width = o.width === undefined ? (kind === 'elevator' ? ELEVATOR_WIDTH_M : ESCALATOR_WIDTH_M) : finite(o.width, `${at}.width`)
    if (width <= 0) throw new Error(`${at}.width: must be > 0, got ${width}`)
    const travel = kind === 'escalator' ? travelOf(serving, lower, upper) : undefined
    return {
      id: code,
      kind,
      // The inventory gives one point per machine, so both ends share x/z unless `ends` gives an escalator a run.
      lower: { x: ends?.lower[0] ?? x, z: ends?.lower[1] ?? z, level: lower.id },
      upper: { x: ends?.upper[0] ?? x, z: ends?.upper[1] ?? z, level: upper.id },
      width,
      ...(travel ? { travel } : {}),
      ...(osmRef === undefined ? {} : { osmRef }),
      sources: srcs('nyopendata', ...(o.at !== undefined || ends ? (['authored'] as const) : []), ...(osmRef === undefined ? [] : (['osm'] as const))),
    }
  })
}
