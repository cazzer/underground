/** Assembles one generated station from its template's levels: slices the sources, assigns tracks, plans
 *  machines, slabs and stairs, and returns the same AuthoredStation + StationSources pair a hand-authored
 *  station has, plus its provenance. Rows the merge can't take are dropped from the slice and named in the
 *  notes and `log`. Pure. */
import type { Level, LevelId, LevelKind } from '../../../src/data/stationSchema.ts'
import type { DepthSource } from '../depth.ts'
import { distanceToRing } from '../stationGeometry.ts'
import type { OsmCatalogWay } from '../catalogTypes.ts'
import type { AuthoredConnector, AuthoredEnd, AuthoredStation, EquipmentRow, FramePoint, GeneratedStation } from '../stationInputs.ts'
import type { TemplateCtx } from './context.ts'
import { machineOverrides } from './machineSites.ts'
import type { MachineSites } from './machineSites.ts'
import { MACHINE_ENTRANCE_TYPES, planMachines } from './machines.ts'
import type { MachinePlan, PlanEntrance } from './machines.ts'
import { mezzanineSlabs, slabDistance, slabOutline } from './slabs.ts'
import { sliceSources } from './slice.ts'
import type { GeneratorCatalog } from './slice.ts'
import { levelStairs, maxStreetRun, streetStairs } from './stairs.ts'
import { assignTracks } from './tracks.ts'
import type { MapTrackLines } from './tracks.ts'

export interface TemplateLevels {
  street: Level
  mezzanine: Level | null
  platform: Level
  /** Depth source of each non-street level. */
  depths: Record<LevelId, DepthSource>
}

export interface TemplateInputs {
  catalog: GeneratorCatalog
  lines: MapTrackLines
  trackWays: ReadonlyMap<string, OsmCatalogWay>
}

/** An entrance row this far from every platform is taken for a data error (R44 lists a stair 850 m away). */
export const FAR_ENTRANCE_M = 200

const pad = (n: number): string => String(n).padStart(2, '0')

/** Throws unless every level is reached from the street through the stairs and machines, and the mezzanine (or
 *  station house) is joined to the street directly: one whose street stairs were all dropped would only hang off
 *  the platform (E 180 St). */
function checkReachable(levels: TemplateLevels, stairs: readonly AuthoredConnector[], plans: readonly MachinePlan[]): void {
  const byKind = new Map([levels.street, levels.mezzanine, levels.platform].flatMap((l) => (l ? [[l.kind, l.id] as const] : [])))
  const levelOf = (end: AuthoredEnd): string => ('entrance' in end ? levels.street.id : end.level)
  const edges = [
    ...stairs.map((c): [string, string] => [levelOf(c.lower), levelOf(c.upper)]),
    ...plans.map((p): [string, string] => [byKind.get(p.kinds[0])!, byKind.get(p.kinds[1])!]),
  ]
  const reached = new Set([levels.street.id])
  for (let grew = true; grew; ) {
    grew = false
    for (const [a, b] of edges) {
      if (reached.has(a) !== reached.has(b)) {
        reached.add(a).add(b)
        grew = true
      }
    }
  }
  const cut = [...byKind.values()].filter((id) => !reached.has(id))
  if (cut.length > 0) throw new Error(`no stair or machine reaches the ${cut.join(' and ')} level from the street`)
  const mezz = levels.mezzanine?.id
  if (mezz && !edges.some(([a, b]) => (a === mezz && b === levels.street.id) || (b === mezz && a === levels.street.id))) {
    throw new Error(`no stair or machine joins the ${mezz} level to the street`)
  }
}

const levelHeights = (levels: TemplateLevels): Partial<Record<LevelKind, number>> =>
  Object.fromEntries([levels.street, levels.mezzanine, levels.platform].flatMap((l) => (l ? [[l.kind, l.y]] : [])))

/** Machines, entrances, slabs and stairs for one set of candidate entrances. `unplaced` lists the entrances whose
 *  street stair found no landing. */
function planLayout(
  ctx: TemplateCtx,
  levels: TemplateLevels,
  candidates: readonly PlanEntrance[],
  rows: readonly EquipmentRow[],
  kinds: ReadonlySet<LevelKind>,
  platformFor: MachineSites['platformFor'],
  log: string[],
) {
  const dropped: string[] = []
  const machines = planMachines(ctx, rows, candidates, kinds)
  dropped.push(...machines.dropped)
  // An elevator or escalator entrance with no machine of its kind can't be linked (checkEntranceLinks).
  const linked = new Set(machines.plans.flatMap((p) => (p.entrance === undefined ? [] : [p.entrance])))
  const keptIndex = new Map<number, number>()
  const entrances: PlanEntrance[] = []
  candidates.forEach((e, i) => {
    if (MACHINE_ENTRANCE_TYPES.has(e.row.type) && !linked.has(i)) {
      dropped.push(`entrance row ${e.row.lat},${e.row.lon} (${e.row.type}): no ${e.row.type.toLowerCase()} in the E&E rows reaches the street here`)
      return
    }
    keptIndex.set(i, entrances.length)
    entrances.push({ ...e, id: `ent-${pad(entrances.length + 1)}` })
  })
  const plans = machines.plans.map((p) => (p.entrance === undefined ? p : { ...p, entrance: keptIndex.get(p.entrance)! }))
  const slabs = levels.mezzanine ? mezzanineSlabs(ctx, entrances.map((e) => e.at)) : []
  const { overrides: equipment, notes: machineNotes, platforms: machinePlatforms } = machineOverrides(ctx, plans, entrances, { slabs, platformFor, levelY: levelHeights(levels) })
  const street = streetStairs(ctx, entrances, slabs, levels, log, machinePlatforms)
  const connectors = [...street.connectors, ...(levels.mezzanine ? levelStairs(ctx, slabs, levels.mezzanine, levels.platform) : [])]
  return { dropped, entrances, plans, slabs, equipment, machineNotes, connectors, unplaced: street.unplaced }
}

export function buildFromTemplate(ctx: TemplateCtx, levels: TemplateLevels, inputs: TemplateInputs, log: string[]): GeneratedStation {
  const wayIds = ctx.platforms.flatMap((p) => p.ways.map((w) => w.id)).sort((a, b) => a - b)
  const slice = sliceSources(inputs.catalog, ctx.row, wayIds)
  const dropped = [...slice.dropped]
  const kinds = new Set([levels.street, levels.mezzanine, levels.platform].flatMap((l) => (l ? [l.kind] : [])))

  const toPlatform = (at: FramePoint): number => Math.min(...ctx.platforms.flatMap((p) => p.ways.map((w) => distanceToRing(at, w.ring))))
  const located: PlanEntrance[] = []
  for (const row of slice.sources.entrances.rows) {
    const at = ctx.uv(row.lat, row.lon)
    const away = toPlatform(at)
    if (away > FAR_ENTRANCE_M) dropped.push(`entrance row ${row.lat},${row.lon} (${row.type}): ${away.toFixed(0)} m from every platform`)
    else located.push({ id: '', row, at })
  }
  // A stair's run is capped, so an entrance farther than the cap from where its stair would land (its slab, or the
  // platform without a mezzanine) is left out; a machine entrance may be that close to either.
  const reach = maxStreetRun((levels.mezzanine ?? levels.platform).y)
  const provisional = levels.mezzanine ? mezzanineSlabs(ctx, located.map((e) => e.at)) : []
  const toSlab = (at: FramePoint): number => Math.min(Infinity, ...provisional.map((sl) => slabDistance(sl, at)))
  const all = located.filter((e) => {
    const away = MACHINE_ENTRANCE_TYPES.has(e.row.type) ? Math.min(toSlab(e.at), toPlatform(e.at)) : levels.mezzanine ? toSlab(e.at) : toPlatform(e.at)
    if (away <= reach) return true
    dropped.push(`entrance row ${e.row.lat},${e.row.lon} (${e.row.type}): ${away.toFixed(0)} m from where its ${MACHINE_ENTRANCE_TYPES.has(e.row.type) ? 'machine' : 'stair'} could land (cap ${reach.toFixed(0)} m)`)
    return false
  })
  const { tracks, swapped } = assignTracks(ctx, inputs.lines, inputs.trackWays)
  const platformFor = { N: tracks.find((t) => t.stopId.endsWith('N'))!.platform, S: tracks.find((t) => t.stopId.endsWith('S'))!.platform }
  // An entrance whose stair finds no free landing within the cap is left out, and the layout is redone without it.
  let candidates = all
  let layout = planLayout(ctx, levels, candidates, slice.sources.equipment.rows, kinds, platformFor, log)
  while (layout.unplaced.length > 0) {
    for (const e of layout.unplaced) dropped.push(`entrance row ${e.row.lat},${e.row.lon} (${e.row.type}): its stair finds no free landing within ${reach.toFixed(0)} m`)
    const gone = new Set(layout.unplaced.map((e) => e.row))
    candidates = candidates.filter((e) => !gone.has(e.row))
    layout = planLayout(ctx, levels, candidates, slice.sources.equipment.rows, kinds, platformFor, log)
  }
  dropped.push(...layout.dropped)
  const { entrances, plans, slabs, equipment, machineNotes, connectors } = layout
  checkReachable(levels, connectors, plans)

  const platforms = ctx.platforms.flatMap((p) => {
    // A platform split into several OSM ways keeps its tracks on the longest one, so each stop has one track.
    const length = (ring: [number, number][]): number => Math.max(...ring.map((q) => q[0])) - Math.min(...ring.map((q) => q[0]))
    const main = [...p.ways].sort((a, b) => length(b.ring) - length(a.ring) || a.id - b.id)[0]!
    return p.ways.map((w) => ({
      id: `way-${w.id}`,
      level: levels.platform.id,
      osmWay: w.id,
      tracks: w === main ? tracks.filter((t) => t.platform === p).map((t) => ({ stopId: t.stopId, path: t.path })) : [],
    }))
  })
  const slabName = levels.mezzanine?.name ?? 'Mezzanine'
  for (const d of dropped) log.push(`${ctx.stationId} dropped ${d}`)
  for (const n of machineNotes) log.push(`${ctx.stationId} UNVERIFIED ${n}`)
  const notes = [
    `Generated from the ${ctx.archetype} template (confidence ${ctx.confidence.toFixed(2)}); not hand-checked.`,
    `Frame: u along bearing ${ctx.bearingDeg.toFixed(1)} deg (the platforms' axis) from the platforms' center, v to its right.`,
    `Tracks: ${swapped ? 'N on the +v side' : 'N on the -v side'}, chosen by the map's direction lines.`,
    'UNVERIFIED: slab extents, stair positions and runs, and machine positions are template guesses.',
    ...tracks.flatMap((t) => (t.note ? [`UNVERIFIED: ${t.note}`] : [])),
    ...machineNotes.map((n) => `UNVERIFIED: ${n}`),
    ...dropped.map((d) => `Dropped: ${d}`),
  ]
  const authored: AuthoredStation = {
    stationId: ctx.stationId,
    name: ctx.name,
    notes,
    frame: { anchor: { lat: ctx.anchor.lat, lon: ctx.anchor.lon }, bearingDeg: ctx.bearingDeg },
    fetch: { osmWays: wayIds, entrancesGtfsStopId: ctx.stationId, equipmentStationMrn: ctx.row.stationId },
    levels: [levels.street, ...(levels.mezzanine ? [levels.mezzanine] : []), levels.platform],
    platforms,
    slabs: slabs.map((s, k) => ({ id: s.id, level: levels.mezzanine!.id, name: slabs.length > 1 ? `${slabName} ${k + 1}` : slabName, outline: slabOutline(s) })),
    entrances: entrances.map((e) => ({ id: e.id, source: [e.row.lat, e.row.lon] })),
    connectors,
    equipment,
    fareLines: [],
  }
  const sources = {
    ...slice.sources,
    entrances: { ...slice.sources.entrances, rows: entrances.map((e) => e.row) },
    equipment: { ...slice.sources.equipment, rows: plans.map((p) => p.row) },
  }
  return {
    authored,
    sources,
    meta: { archetype: ctx.archetype, confidence: Math.round(ctx.confidence * 100) / 100, levelDepths: levels.depths },
  }
}
