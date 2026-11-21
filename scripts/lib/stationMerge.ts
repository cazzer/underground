/** Pure merge of a hand-authored station with pinned OSM / NY Open Data extracts into the
 *  StationInterior contract. Hand-edited input is read through the path-labelled checkers, so a bad
 *  field fails with its JSON path. No IO. */
import type {
  Connector, Endpoint, Entrance, FareLine, InteriorSource, Level, LocalPoint, Platform, Slab, StationInterior,
} from '../../src/data/stationSchema.ts'
import { finite, list, oneOf, pair, record, text } from './check.ts'
import type { AuthoredStation, EquipmentRow, StationSources } from './stationInputs.ts'
import { distanceToRing, makeFrame, openRing } from './stationGeometry.ts'
import type { Frame } from './stationGeometry.ts'
import { parseServing } from './stationSources.ts'

/** Estimates: the E&E inventory has no shaft or escalator width. Override per machine. */
export const ELEVATOR_WIDTH_M = 2
export const ESCALATOR_WIDTH_M = 1.2
const ROW_TOLERANCE_DEG = 1e-6
const CONTAINMENT_M = 0.5
const ATTRIBUTION: Record<'osm' | 'nyopendata', string> = {
  osm: '© OpenStreetMap contributors',
  nyopendata: 'Metropolitan Transportation Authority, data.ny.gov',
}

interface Ctx {
  frame: Frame
  levels: Map<string, Level>
  street: Level
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const srcs = (...s: InteriorSource[]): InteriorSource[] => [...new Set(s)].sort()

function levelOf(ctx: Ctx, id: unknown, path: string): Level {
  const level = ctx.levels.get(text(id, path))
  if (!level) throw new Error(`${path}: unknown level ${JSON.stringify(id)}`)
  return level
}

function points(ctx: Ctx, v: unknown, path: string, min: number): LocalPoint[] {
  const out = list(v, path).map((p, i) => ctx.frame.fromUV(pair(p, `${path}[${i}]`)))
  if (out.length < min) throw new Error(`${path}: needs at least ${min} points`)
  return out
}

function buildLevels(authored: AuthoredStation): Level[] {
  const seen = new Set<string>()
  const levels = list(authored.levels, 'levels').map((l, i): Level => {
    const at = `levels[${i}]`
    const r = record(l, at)
    const id = text(r.id, `${at}.id`)
    if (seen.has(id)) throw new Error(`${at}.id: duplicate level id ${id}`)
    seen.add(id)
    const kind = oneOf(r.kind, ['street', 'mezzanine', 'platform'], `${at}.kind`)
    return { id, name: text(r.name, `${at}.name`), kind, y: finite(r.y, `${at}.y`) }
  })
  const streets = levels.filter((l) => l.kind === 'street')
  if (streets.length !== 1) throw new Error(`levels: expected exactly one street level, got ${streets.length}`)
  if (streets[0]!.y !== 0) throw new Error(`levels: the street level must have y = 0, got ${streets[0]!.y}`)
  return levels.sort((a, b) => b.y - a.y)
}

function buildPlatforms(authored: AuthoredStation, sources: StationSources, ctx: Ctx): Platform[] {
  return list(authored.platforms, 'platforms').map((p, i): Platform => {
    const at = `platforms[${i}]`
    const r = record(p, at)
    const id = text(r.id, `${at}.id`)
    const wayId = finite(r.osmWay, `${at}.osmWay`)
    const way = sources.osm.ways.find((w) => w.id === wayId)
    if (!way) throw new Error(`${at}: OSM way ${wayId} is not in the pinned sources (run npm run data:stations:fetch)`)
    const ring = way.ring.map(([lat, lon], k) =>
      ctx.frame.fromLatLon(finite(lat, `osm way ${wayId}[${k}].lat`), finite(lon, `osm way ${wayId}[${k}].lon`)),
    )
    const tracks = list(r.tracks, `${at}.tracks`).map((t, j) => {
      const tr = record(t, `${at}.tracks[${j}]`)
      const stopId = text(tr.stopId, `${at}.tracks[${j}].stopId`)
      if (!stopId.startsWith(authored.stationId)) throw new Error(`${at}.tracks[${j}].stopId: ${stopId} is not a stop of ${authored.stationId}`)
      return { stopId, path: points(ctx, tr.path, `${at}.tracks[${j}].path`, 2) }
    })
    return { id, level: levelOf(ctx, r.level, `${at}.level`).id, outline: openRing(ring, `platform ${id}`), tracks, osmRef: `way/${wayId}`, sources: srcs('authored', 'osm') }
  })
}

function buildSlabs(authored: AuthoredStation, ctx: Ctx): Slab[] {
  return list(authored.slabs, 'slabs').map((s, i): Slab => {
    const at = `slabs[${i}]`
    const r = record(s, at)
    return {
      id: text(r.id, `${at}.id`),
      level: levelOf(ctx, r.level, `${at}.level`).id,
      name: text(r.name, `${at}.name`),
      outline: openRing(points(ctx, r.outline, `${at}.outline`, 3), `slab ${String(r.id)}`),
      sources: ['authored'],
    }
  })
}

function buildFareLines(authored: AuthoredStation, ctx: Ctx): FareLine[] {
  return list(authored.fareLines, 'fareLines').map((f, i): FareLine => {
    const at = `fareLines[${i}]`
    const r = record(f, at)
    return {
      id: text(r.id, `${at}.id`),
      level: levelOf(ctx, r.level, `${at}.level`).id,
      path: points(ctx, r.path, `${at}.path`, 2),
      sources: ['authored'],
    }
  })
}

/** Each authored key matches exactly one Open Data row, and every row is claimed once. */
function buildEntrances(authored: AuthoredStation, sources: StationSources, ctx: Ctx): Map<string, Entrance> {
  const rows = sources.entrances.rows
  const claimed = new Map<number, string>()
  const out = new Map<string, Entrance>()
  list(authored.entrances, 'entrances').forEach((e, i) => {
    const at = `entrances[${i}]`
    const r = record(e, at)
    const id = text(r.id, `${at}.id`)
    const [lat, lon] = pair(r.source, `${at}.source`)
    const hits = rows.flatMap((row, k) =>
      Math.abs(row.lat - lat) <= ROW_TOLERANCE_DEG && Math.abs(row.lon - lon) <= ROW_TOLERANCE_DEG ? [k] : [],
    )
    if (hits.length !== 1) throw new Error(`${at} (${id}): ${lat},${lon} matches ${hits.length} Open Data rows, expected 1`)
    const row = rows[hits[0]!]!
    const owner = claimed.get(hits[0]!)
    if (owner !== undefined) throw new Error(`${at} (${id}): row ${lat},${lon} is already claimed by entrance ${owner}`)
    claimed.set(hits[0]!, id)
    if (out.has(id)) throw new Error(`${at}.id: duplicate entrance id ${id}`)
    const [x, z] = ctx.frame.fromLatLon(finite(row.lat, `${at} row.lat`), finite(row.lon, `${at} row.lon`))
    out.set(id, { id, x, z, type: row.type, entry: row.entry, exit: row.exit, connectors: [], sources: ['nyopendata'] })
  })
  const missing = rows.filter((_, k) => !claimed.has(k)).map((row) => `${row.lat},${row.lon} (${row.type})`)
  if (missing.length > 0) throw new Error(`Open Data entrance rows not mapped in the authored file: ${missing.join('; ')}. Add them to entrances.`)
  return out
}

function entranceOf(entrances: Map<string, Entrance>, id: unknown, path: string): Entrance {
  const e = entrances.get(text(id, path))
  if (!e) throw new Error(`${path}: unknown entrance ${JSON.stringify(id)}`)
  return e
}

function buildStairs(authored: AuthoredStation, ctx: Ctx, entrances: Map<string, Entrance>): Connector[] {
  return list(authored.connectors, 'connectors').map((c, i): Connector => {
    const at = `connectors[${i}]`
    const r = record(c, at)
    const id = text(r.id, `${at}.id`)
    const end = (role: 'lower' | 'upper'): { end: Endpoint; viaEntrance: Entrance | undefined } => {
      const e = record(r[role], `${at}.${role}`)
      if ('entrance' in e) {
        if (role !== 'upper') throw new Error(`${at}.lower: an entrance can only be the upper end`)
        const entrance = entranceOf(entrances, e.entrance, `${at}.upper.entrance`)
        return { end: { x: entrance.x, z: entrance.z, level: ctx.street.id }, viaEntrance: entrance }
      }
      const [x, z] = ctx.frame.fromUV(pair(e.at, `${at}.${role}.at`))
      return { end: { x, z, level: levelOf(ctx, e.level, `${at}.${role}.level`).id }, viaEntrance: undefined }
    }
    const lower = end('lower')
    const upper = end('upper')
    upper.viaEntrance?.connectors.push(id)
    const width = finite(r.width, `${at}.width`)
    if (width <= 0) throw new Error(`${at}.width: must be > 0, got ${width}`)
    if (ctx.levels.get(lower.end.level)!.y >= ctx.levels.get(upper.end.level)!.y) {
      throw new Error(`${at} (${id}): lower end must be below the upper end`)
    }
    return {
      id,
      kind: oneOf(r.kind, ['stair', 'ramp'], `${at}.kind`),
      lower: lower.end,
      upper: upper.end,
      width,
      sources: srcs('authored', ...(upper.viaEntrance ? (['nyopendata'] as const) : [])),
    }
  })
}

/** One connector per E&E row; the level pair comes from the serving text. */
function buildMachines(authored: AuthoredStation, sources: StationSources, ctx: Ctx, entrances: Map<string, Entrance>): Connector[] {
  const rows = sources.equipment.rows
  const overrides = list(authored.equipment, 'equipment').map((o, i) => ({ at: `equipment[${i}]`, o: record(o, `equipment[${i}]`) }))
  for (const { at, o } of overrides) {
    if (!rows.some((row) => row.code === o.code)) throw new Error(`${at}.code: no E&E row for ${JSON.stringify(o.code)}`)
  }
  return rows.map((row: EquipmentRow): Connector => {
    const ov = overrides.find(({ o }) => o.code === row.code)
    const at = ov?.at ?? `equipment ${row.code}`
    const o = ov?.o ?? {}
    const levelIds = o.levels === undefined ? undefined : record(o.levels, `${at}.levels`)
    const pick = (kind: Level['kind']): Level => {
      const found = [...ctx.levels.values()].filter(
        (l) => l.kind === kind && (!levelIds || l.id === levelIds.lower || l.id === levelIds.upper),
      )
      if (found.length !== 1) throw new Error(`${at}: ${row.serving} -> ${found.length} ${kind} levels; add "levels" to the override`)
      return found[0]!
    }
    const serving = parseServing(row.serving)
    const from = pick(serving.from)
    const to = pick(serving.to)
    if (from.y === to.y) throw new Error(`${at}: ${row.serving} joins two levels at the same elevation`)
    const [lowerLevel, upperLevel] = from.y < to.y ? [from, to] : [to, from]
    const entrance = o.entrance === undefined ? undefined : entranceOf(entrances, o.entrance, `${at}.entrance`)
    const [x, z] = o.at !== undefined ? ctx.frame.fromUV(pair(o.at, `${at}.at`)) : entrance ? [entrance.x, entrance.z] : ctx.frame.fromLatLon(row.lat, row.lon)
    entrance?.connectors.push(row.code)
    const width = o.width === undefined ? (row.kind === 'elevator' ? ELEVATOR_WIDTH_M : ESCALATOR_WIDTH_M) : finite(o.width, `${at}.width`)
    if (width <= 0) throw new Error(`${at}.width: must be > 0, got ${width}`)
    return {
      id: row.code,
      kind: row.kind,
      // The inventory gives one point per machine, so both ends share x/z.
      lower: { x, z, level: lowerLevel.id },
      upper: { x, z, level: upperLevel.id },
      width,
      ...(row.kind === 'escalator' ? { travel: from.y > to.y ? ('down' as const) : ('up' as const) } : {}),
      sources: srcs('nyopendata', ...(o.at !== undefined ? (['authored'] as const) : [])),
    }
  })
}

function checkEntranceLinks(entrances: Map<string, Entrance>, connectors: Connector[]): void {
  for (const e of entrances.values()) {
    if (e.connectors.length === 0) throw new Error(`entrance ${e.id}: no connector reaches it`)
    e.connectors.sort()
    if (!['Stair', 'Elevator', 'Escalator', 'Ramp'].includes(e.type)) continue
    for (const id of e.connectors) {
      const kind = connectors.find((c) => c.id === id)!.kind
      if (kind !== e.type.toLowerCase()) throw new Error(`entrance ${e.id} is a ${e.type} but connector ${id} is a ${kind}`)
    }
  }
}

function checkContainment(connectors: Connector[], areas: (Platform | Slab)[], ctx: Ctx): void {
  for (const c of connectors) {
    for (const [name, end] of [['lower', c.lower], ['upper', c.upper]] as const) {
      if (ctx.levels.get(end.level)!.kind === 'street') continue
      const nearest = Math.min(...areas.filter((a) => a.level === end.level).map((a) => distanceToRing([end.x, end.z], a.outline)))
      if (!(nearest <= CONTAINMENT_M)) {
        throw new Error(`connector ${c.id} ${name} end at ${end.x},${end.z} is ${nearest.toFixed(2)} m outside every polygon on level ${end.level}`)
      }
    }
  }
}

export function buildStationInterior(authored: AuthoredStation, sources: StationSources): StationInterior {
  const stationId = text(authored.stationId, 'stationId')
  const levels = buildLevels(authored)
  const ctx: Ctx = {
    frame: makeFrame({
      anchor: { lat: finite(authored.frame.anchor.lat, 'frame.anchor.lat'), lon: finite(authored.frame.anchor.lon, 'frame.anchor.lon') },
      bearingDeg: finite(authored.frame.bearingDeg, 'frame.bearingDeg'),
    }),
    levels: new Map(levels.map((l) => [l.id, l])),
    street: levels.find((l) => l.kind === 'street')!,
  }
  const platforms = buildPlatforms(authored, sources, ctx)
  const slabs = buildSlabs(authored, ctx)
  const fareLines = buildFareLines(authored, ctx)
  const entrances = buildEntrances(authored, sources, ctx)
  const connectors = [...buildStairs(authored, ctx, entrances), ...buildMachines(authored, sources, ctx, entrances)]
  checkEntranceLinks(entrances, connectors)
  checkContainment(connectors, [...platforms, ...slabs], ctx)

  const entranceList = [...entrances.values()]
  const ids = new Set<string>()
  for (const { id } of [...platforms, ...slabs, ...connectors, ...entranceList, ...fareLines]) {
    if (ids.has(id)) throw new Error(`duplicate id ${id}`)
    ids.add(id)
  }
  const used = new Set([...platforms, ...slabs, ...connectors, ...entranceList, ...fareLines].flatMap((e) => e.sources))
  return {
    stationId,
    name: text(authored.name, 'name'),
    anchor: { lat: authored.frame.anchor.lat, lon: authored.frame.anchor.lon },
    license: 'ODbL-1.0',
    attribution: (['osm', 'nyopendata'] as const).filter((s) => used.has(s)).map((s) => ATTRIBUTION[s]),
    levels,
    platforms: platforms.sort(byId),
    slabs: slabs.sort(byId),
    connectors: connectors.sort(byId),
    entrances: entranceList.sort(byId),
    fareLines: fareLines.sort(byId),
  }
}
