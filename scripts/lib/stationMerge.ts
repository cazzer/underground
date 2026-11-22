/** Pure merge of a hand-authored station with pinned OSM / NY Open Data extracts into the
 *  StationInterior contract. Hand-edited input is read through the path-labelled checkers, so a bad
 *  field fails with its JSON path. No IO. */
import type {
  Connector, DepthSource, Entrance, FareLine, Level, LocalPoint, Platform, Slab, StationInterior,
} from '../../src/data/stationSchema.ts'
import { bool, finite, list, oneOf, pair, record, text } from './check.ts'
import type { Ctx } from './stationCtx.ts'
import { levelOf, srcs } from './stationCtx.ts'
import { buildAuthoredConnectors, checkContainment } from './stationConnectors.ts'
import { buildMachines } from './stationEquipment.ts'
import { makeFrame, openRing } from './stationGeometry.ts'
import type { AuthoredStation, StationSources } from './stationInputs.ts'
import { checkMembers, trackOwner } from './stationMembers.ts'

const DEPTH_SOURCES = ['ee-rise', 'deep-list', 'osm-level', 'structure-default'] as const satisfies readonly DepthSource[]
const ROW_TOLERANCE_DEG = 1e-6
export const MTA_CREDIT = 'Metropolitan Transportation Authority, data.ny.gov'
const ATTRIBUTION: Record<'osm' | 'nyopendata', string> = {
  osm: '© OpenStreetMap contributors',
  nyopendata: MTA_CREDIT,
}

/** Appended after the MTA credit: the nyopendata elements, and level heights derived from E&E rises, are not ODbL (user's licensing decisions, cards 9wc.1.1 option A and 2q7.29.1 option A). */
export const OPEN_NY_NOTE =
  'Elements whose sources include nyopendata, and level heights whose depthSource is ee-rise, contain MTA data from data.ny.gov under the OPEN-NY Terms of Use, not ODbL'

/** A file with an `ee-rise` level height carries the MTA credit and OPEN_NY_NOTE even with no nyopendata element, in the credits' fixed order (card 2q7.29.1). */
export function withEeRiseCredit(attribution: readonly string[], levels: readonly Pick<Level, 'depthSource'>[]): string[] {
  if (!levels.some((l) => l.depthSource === 'ee-rise')) return [...attribution]
  const order = [ATTRIBUTION.osm, MTA_CREDIT, OPEN_NY_NOTE]
  const out = new Set([...attribution, MTA_CREDIT, OPEN_NY_NOTE])
  return [...out].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
}

/** The street files' counterpart of OPEN_NY_NOTE: their entrance points are MTA data, the rest of the file is OSM. */
export const ENTRANCES_OPEN_NY_NOTE = 'Entrances are MTA data from data.ny.gov under the OPEN-NY Terms of Use, not ODbL'

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function points(ctx: Ctx, v: unknown, path: string, min: number): LocalPoint[] {
  const out = list(v, path).map((p, i) => ctx.frame.fromUV(pair(p, `${path}[${i}]`)))
  if (out.length < min) throw new Error(`${path}: needs at least ${min} points`)
  return out
}

/** The `approximate` marker is `true` or absent; `false` is a mistake, not a way to say "surveyed". */
function onlyTrue(v: unknown, path: string): true {
  if (v !== true) throw new Error(`${path}: expected true or absent, got ${JSON.stringify(v)}`)
  return true
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
    const depthSource = r.depthSource === undefined ? undefined : oneOf(r.depthSource, DEPTH_SOURCES, `${at}.depthSource`)
    if (depthSource !== undefined && kind === 'street') throw new Error(`${at}.depthSource: the street level has no depth source`)
    return { id, name: text(r.name, `${at}.name`), kind, y: finite(r.y, `${at}.y`), ...(depthSource === undefined ? {} : { depthSource }) }
  })
  const streets = levels.filter((l) => l.kind === 'street')
  if (streets.length !== 1) throw new Error(`levels: expected exactly one street level, got ${streets.length}`)
  if (streets[0]!.y !== 0) throw new Error(`levels: the street level must have y = 0, got ${streets[0]!.y}`)
  return levels.sort((a, b) => b.y - a.y)
}

function buildPlatforms(authored: AuthoredStation, members: readonly string[], sources: StationSources, ctx: Ctx): Platform[] {
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
      if (trackOwner(stopId, members) === undefined) throw new Error(`${at}.tracks[${j}].stopId: ${stopId} is not a stop of ${members.join(', ')}`)
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
      ...(r.paid === undefined ? {} : { paid: bool(r.paid, `${at}.paid`) }),
      ...(r.approximate === undefined ? {} : { approximate: onlyTrue(r.approximate, `${at}.approximate`) }),
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
    const rowAt = `sources.entrances.rows[${hits[0]}]`
    const owner = claimed.get(hits[0]!)
    if (owner !== undefined) throw new Error(`${at} (${id}): row ${lat},${lon} is already claimed by entrance ${owner}`)
    claimed.set(hits[0]!, id)
    if (out.has(id)) throw new Error(`${at}.id: duplicate entrance id ${id}`)
    const [x, z] = ctx.frame.fromLatLon(finite(row.lat, `${rowAt}.lat`), finite(row.lon, `${rowAt}.lon`))
    out.set(id, {
      id, x, z, type: text(row.type, `${rowAt}.type`), entry: bool(row.entry, `${rowAt}.entry`), exit: bool(row.exit, `${rowAt}.exit`),
      connectors: [], sources: ['nyopendata'],
    })
  })
  const missing = rows.filter((_, k) => !claimed.has(k)).map((row) => `${row.lat},${row.lon} (${row.type})`)
  if (missing.length > 0) throw new Error(`Open Data entrance rows not mapped in the authored file: ${missing.join('; ')}. Add them to entrances.`)
  return out
}

/** Every entrance has a connector of a matching kind, and no connector is listed by two entrances. Sorts each list. */
export function checkEntranceLinks(entrances: Map<string, Entrance>, connectors: Connector[]): void {
  const owner = new Map<string, string>()
  for (const e of entrances.values()) {
    if (e.connectors.length === 0) throw new Error(`entrance ${e.id}: no connector reaches it`)
    e.connectors.sort()
    for (const id of e.connectors) {
      const other = owner.get(id)
      // The same entrance listing an id twice is a duplicate id, reported by the id check after this one.
      if (other !== undefined && other !== e.id) throw new Error(`connector ${id} is listed by two entrances, ${other} and ${e.id}`)
      owner.set(id, e.id)
    }
    if (!['Stair', 'Elevator', 'Escalator', 'Ramp'].includes(e.type)) continue
    for (const id of e.connectors) {
      const kind = connectors.find((c) => c.id === id)!.kind
      if (kind !== e.type.toLowerCase()) throw new Error(`entrance ${e.id} is a ${e.type} but connector ${id} is a ${kind}`)
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
  const members = checkMembers(stationId, authored.memberStationIds, 'memberStationIds')
  const platforms = buildPlatforms(authored, members ?? [stationId], sources, ctx)
  const slabs = buildSlabs(authored, ctx)
  const fareLines = buildFareLines(authored, ctx)
  const entrances = buildEntrances(authored, sources, ctx)
  const areas = new Map<string, Platform | Slab>([...platforms, ...slabs].map((a) => [a.id, a]))
  const connectors = [...buildAuthoredConnectors(authored, sources, ctx, entrances, areas), ...buildMachines(authored, sources, ctx, entrances)]
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
    ...(members ? { memberStationIds: members } : {}),
    name: text(authored.name, 'name'),
    ...(authored.approximate === undefined ? {} : { approximate: onlyTrue(authored.approximate, 'approximate') }),
    anchor: { lat: authored.frame.anchor.lat, lon: authored.frame.anchor.lon },
    license: 'ODbL-1.0',
    attribution: withEeRiseCredit(
      [
        ...(['osm', 'nyopendata'] as const).filter((s) => used.has(s)).map((s) => ATTRIBUTION[s]),
        ...(used.has('nyopendata') ? [OPEN_NY_NOTE] : []),
      ],
      levels,
    ),
    levels,
    platforms: platforms.sort(byId),
    slabs: slabs.sort(byId),
    connectors: connectors.sort(byId),
    entrances: entranceList.sort(byId),
    fareLines: fareLines.sort(byId),
  }
}
