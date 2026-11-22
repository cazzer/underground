/** Built station interiors to public/data/station-depths.json: each platform track's ends and rail height. Pure. */
import type { StationDepth, StationDepthsFile, StationInterior, TrackDepth } from '../../src/data/stationSchema.ts'
import { RAIL_DROP_M } from '../../src/lib/interiorGeometry.ts'
import { OPEN_NY_NOTE } from './stationMerge.ts'
import { membersOf, trackOwner } from './stationMembers.ts'

const OSM_CREDIT = '© OpenStreetMap contributors'
/** Only when a rail height comes from an E&E rise (an MTA/OPEN-NY value); the interiors' own OPEN-NY note is about their elements. */
export const DEPTHS_OPEN_NY_NOTE = 'Some railY values come from E&E rises and are MTA data under the OPEN-NY Terms of Use'
const round2 = (v: number): number => Math.round(v * 100) / 100

const byStopId = (a: TrackDepth, b: TrackDepth): number => (a.stopId < b.stopId ? -1 : a.stopId > b.stopId ? 1 : 0)

/** One entry per member station (one for an ordinary interior), each with the tracks whose stop it owns. */
function stationDepths(interior: StationInterior): StationDepth[] {
  const levelY = new Map(interior.levels.map((l) => [l.id, l.y]))
  const members = membersOf(interior)
  const byMember = new Map<string, TrackDepth[]>(members.map((m) => [m, []]))
  for (const p of interior.platforms) {
    const y = levelY.get(p.level)
    if (y === undefined) throw new Error(`${interior.stationId}: platform ${p.id} is on unknown level "${p.level}"`)
    for (const t of p.tracks) {
      const first = t.path[0]
      const last = t.path.at(-1)
      if (!first || !last || t.path.length < 2) throw new Error(`${interior.stationId}: track ${t.stopId} needs 2+ points`)
      // The merge guarantees every stop belongs to a member; a lone station owns its tracks whatever they are named.
      const owner = trackOwner(t.stopId, members) ?? (members.length === 1 ? members[0] : undefined)
      if (owner === undefined) throw new Error(`${interior.stationId}: track ${t.stopId} is not a stop of ${members.join(', ')}`)
      byMember.get(owner)!.push({ stopId: t.stopId, railY: round2(y - RAIL_DROP_M), ends: [first, last] })
    }
  }
  return members.map((stationId) => {
    const tracks = byMember.get(stationId)!.sort(byStopId)
    for (let i = 1; i < tracks.length; i++) {
      if (tracks[i]!.stopId === tracks[i - 1]!.stopId) throw new Error(`${interior.stationId}: two tracks serve ${tracks[i]!.stopId}`)
    }
    return { stationId, anchor: interior.anchor, tracks }
  })
}

/** True when a platform that contributes a rail height sits on a level whose depth is a measured E&E rise. */
function usesEeRise(interior: StationInterior): boolean {
  const onRise = new Set(interior.levels.filter((l) => l.depthSource === 'ee-rise').map((l) => l.id))
  return interior.platforms.some((p) => p.tracks.length > 0 && onRise.has(p.level))
}

/** One entry per station (a complex contributes one per member), sorted by station id. The file inherits the interiors' ODbL license and credits. */
export function buildStationDepths(interiors: readonly StationInterior[]): StationDepthsFile {
  const sorted = [...interiors].sort((a, b) => (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0))
  const credits = [...new Set(sorted.flatMap((i) => i.attribution))].filter((c) => c !== OPEN_NY_NOTE)
  if (sorted.some(usesEeRise)) credits.push(DEPTHS_OPEN_NY_NOTE)
  credits.sort((a, b) => Number(b === OSM_CREDIT) - Number(a === OSM_CREDIT))
  for (const i of sorted) {
    if (i.license !== 'ODbL-1.0') throw new Error(`${i.stationId}: unexpected license ${JSON.stringify(i.license)}`)
  }
  const stations = sorted.flatMap(stationDepths).sort((a, b) => (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0))
  for (let i = 1; i < stations.length; i++) {
    if (stations[i]!.stationId === stations[i - 1]!.stationId) throw new Error(`station ${stations[i]!.stationId} has depths from two interiors`)
  }
  return { license: 'ODbL-1.0', attribution: credits, stations }
}
