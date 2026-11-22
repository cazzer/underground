/** The authored connectors (stairs, ramps, walkways) of the station merge, and the check that every connector end
 *  stands on a platform or slab. Hand-edited input is read through the path-labelled checkers. No IO. */
import type { Connector, Endpoint, Entrance, Platform, Slab } from '../../src/data/stationSchema.ts'
import { finite, list, oneOf, pair, record, text } from './check.ts'
import type { Ctx } from './stationCtx.ts'
import { entranceOf, levelOf, srcs } from './stationCtx.ts'
import { distanceToRing } from './stationGeometry.ts'
import type { AuthoredStation, StationSources } from './stationInputs.ts'
import { checkOsmRef } from './stationOsmRef.ts'

const CONTAINMENT_M = 0.5
/** A walkway shorter than this has no direction to draw. */
export const MIN_WALKWAY_RUN_M = 1

type Area = Platform | Slab

/** The area an `at` end names: a platform or slab of the end's own level. */
function areaOf(areas: ReadonlyMap<string, Area>, raw: unknown, level: string, path: string): string {
  const id = text(raw, path)
  const area = areas.get(id)
  if (!area) throw new Error(`${path}: unknown platform or slab ${JSON.stringify(id)}`)
  if (area.level !== level) throw new Error(`${path}: ${id} is on level ${area.level}, not ${level}`)
  return id
}

function buildEnd(
  ctx: Ctx, entrances: Map<string, Entrance>, areas: ReadonlyMap<string, Area>, raw: unknown, at: string, walkway: boolean,
): { end: Endpoint; viaEntrance: Entrance | undefined } {
  const e = record(raw, at)
  // Either end may be an entrance: it sits on the street, which is the lowest level at an elevated station.
  // The lower-below-upper check then rejects an entrance end on the wrong side of the other end.
  if ('entrance' in e) {
    if (walkway) throw new Error(`${at}: a walkway has no entrance end`)
    if ('area' in e) throw new Error(`${at}.area: an entrance end is on the street and has no area`)
    const entrance = entranceOf(entrances, e.entrance, `${at}.entrance`)
    return { end: { x: entrance.x, z: entrance.z, level: ctx.street.id }, viaEntrance: entrance }
  }
  const [x, z] = ctx.frame.fromUV(pair(e.at, `${at}.at`))
  const levelInfo = levelOf(ctx, e.level, `${at}.level`)
  const level = levelInfo.id
  if (e.area !== undefined && levelInfo.kind === 'street') throw new Error(`${at}.area: an end on the street level has no area`)
  const end: Endpoint = { x, z, level }
  if (e.area !== undefined) end.area = areaOf(areas, e.area, level, `${at}.area`)
  return { end, viaEntrance: undefined }
}

function checkWalkway(ctx: Ctx, id: string, at: string, lower: Endpoint, upper: Endpoint): void {
  if (lower.level !== upper.level) throw new Error(`${at} (${id}): a walkway stays on one level, got ${lower.level} and ${upper.level}`)
  if (ctx.levels.get(lower.level)!.kind === 'street') throw new Error(`${at} (${id}): a walkway is not on the street level`)
  const run = Math.hypot(upper.x - lower.x, upper.z - lower.z)
  if (run < MIN_WALKWAY_RUN_M) throw new Error(`${at} (${id}): a walkway runs at least ${MIN_WALKWAY_RUN_M} m, got ${run.toFixed(2)} m`)
  if (lower.area === undefined || upper.area === undefined) throw new Error(`${at} (${id}): a walkway names the area at each end`)
  if (lower.area === upper.area) throw new Error(`${at} (${id}): a walkway joins two different areas, both ends are on ${lower.area}`)
}

export function buildAuthoredConnectors(
  authored: AuthoredStation, sources: StationSources, ctx: Ctx, entrances: Map<string, Entrance>, areas: ReadonlyMap<string, Area>,
): Connector[] {
  return list(authored.connectors, 'connectors').map((c, i): Connector => {
    const at = `connectors[${i}]`
    const r = record(c, at)
    const id = text(r.id, `${at}.id`)
    const kind = oneOf(r.kind, ['stair', 'ramp', 'walkway'], `${at}.kind`)
    const walkway = kind === 'walkway'
    const lower = buildEnd(ctx, entrances, areas, r.lower, `${at}.lower`, walkway)
    const upper = buildEnd(ctx, entrances, areas, r.upper, `${at}.upper`, walkway)
    // Both ends on entrances would be two street ends; the elevation check below rejects that.
    const viaEntrance = lower.viaEntrance ?? upper.viaEntrance
    viaEntrance?.connectors.push(id)
    const width = finite(r.width, `${at}.width`)
    if (width <= 0) throw new Error(`${at}.width: must be > 0, got ${width}`)
    if (walkway) {
      checkWalkway(ctx, id, at, lower.end, upper.end)
    } else if (ctx.levels.get(lower.end.level)!.y >= ctx.levels.get(upper.end.level)!.y) {
      throw new Error(`${at} (${id}): lower end must be below the upper end`)
    }
    const osmRef = r.osmRef === undefined ? undefined : checkOsmRef(
      ctx, sources, r.osmRef, [lower, upper].filter((e) => e.viaEntrance === undefined).map((e): [number, number] => [e.end.x, e.end.z]), `${at}.osmRef`,
    )
    return {
      id,
      kind,
      lower: lower.end,
      upper: upper.end,
      width,
      ...(osmRef === undefined ? {} : { osmRef }),
      sources: srcs('authored', ...(viaEntrance ? (['nyopendata'] as const) : []), ...(osmRef === undefined ? [] : (['osm'] as const))),
    }
  })
}

/** Every connector end off the street is within CONTAINMENT_M of its named area, else of some polygon on its level. */
export function checkContainment(connectors: Connector[], areas: Area[], ctx: Ctx): void {
  for (const c of connectors) {
    for (const [name, end] of [['lower', c.lower], ['upper', c.upper]] as const) {
      if (ctx.levels.get(end.level)!.kind === 'street') continue
      const named = end.area === undefined ? undefined : areas.find((a) => a.id === end.area)
      const candidates = named ? [named] : areas.filter((a) => a.level === end.level)
      const nearest = Math.min(...candidates.map((a) => distanceToRing([end.x, end.z], a.outline)))
      if (!(nearest <= CONTAINMENT_M)) {
        const where = named ? `its area ${named.id}` : `every polygon on level ${end.level}`
        throw new Error(`connector ${c.id} ${name} end at ${end.x},${end.z} is ${nearest.toFixed(2)} m outside ${where}`)
      }
    }
  }
}
