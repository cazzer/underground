/** Station complexes for stations.json: the catalog's complex_id (MTA 39hk-dx4f) is the source of truth. Pure; `.ts`
 *  imports because a test and the build scripts share it. */
import type { StationId } from '../../src/data/schema.ts'

/** Members within this many metres of the same distance from the centroid tie for lead (then routes, then id). */
export const LEAD_TIE_M = 1

export interface ComplexStation {
  id: string
  lat: number
  lon: number
  routes: readonly string[]
}
export interface ComplexBuild {
  complexes: StationId[][]
  warnings: string[]
}

const M_PER_DEG = 111_320

/** The catalog's complexes with 2+ stations.json members: lead first (nearest the members' centroid, distances within
 *  LEAD_TIE_M tie, then more routes, then lower id), the rest by id; sorted by lead. A member stations.json lacks is
 *  dropped with a warning (a group left with one member is no complex). Throws on a GTFS id in two complexes. */
export function buildComplexes(
  stations: readonly ComplexStation[],
  rows: readonly { gtfsStopId: string; complexId: string }[],
): ComplexBuild {
  const byId = new Map(stations.map((s) => [s.id, s]))
  const warnings: string[] = []
  const claimed = new Map<string, string>()
  const byComplex = new Map<string, ComplexStation[]>()
  for (const row of rows) {
    const earlier = claimed.get(row.gtfsStopId)
    if (earlier !== undefined && earlier !== row.complexId) {
      throw new Error(`station ${row.gtfsStopId} is in two complexes (${earlier} and ${row.complexId}) in the catalog`)
    }
    claimed.set(row.gtfsStopId, row.complexId)
    const station = byId.get(row.gtfsStopId)
    if (!station) {
      warnings.push(`catalog complex ${row.complexId}: member ${row.gtfsStopId} is not in stations.json`)
      continue
    }
    const members = byComplex.get(row.complexId) ?? []
    if (!members.includes(station)) members.push(station)
    byComplex.set(row.complexId, members)
  }
  const complexes: StationId[][] = []
  for (const members of byComplex.values()) {
    if (members.length < 2) continue
    const lead = leadOf(members)
    complexes.push([lead.id, ...members.filter((m) => m !== lead).map((m) => m.id).sort(compareId)])
  }
  complexes.sort((a, b) => compareId(a[0]!, b[0]!))
  return { complexes, warnings }
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function leadOf(members: readonly ComplexStation[]): ComplexStation {
  const lat0 = members.reduce((n, m) => n + m.lat, 0) / members.length
  const lon0 = members.reduce((n, m) => n + m.lon, 0) / members.length
  const kx = Math.cos((lat0 * Math.PI) / 180)
  const dist = (m: ComplexStation): number => Math.hypot((m.lon - lon0) * kx, m.lat - lat0) * M_PER_DEG
  const ranked = members.map((m) => ({ m, d: dist(m) })).sort((a, b) => a.d - b.d)
  const nearest = ranked[0]!.d
  const tied = ranked.filter((r) => r.d - nearest <= LEAD_TIE_M).map((r) => r.m)
  tied.sort((a, b) => b.routes.length - a.routes.length || compareId(a.id, b.id))
  return tied[0]!
}

/** Throws unless every interior that covers a complex member also covers its lead (the map only focuses leads). */
export function checkComplexLeads(
  interiors: readonly { stationId: string; memberStationIds?: readonly string[] }[],
  complexes: readonly (readonly string[])[],
): void {
  const leadById = new Map<string, string>()
  for (const group of complexes) for (const id of group) leadById.set(id, group[0]!)
  for (const interior of interiors) {
    const covered = new Set(interior.memberStationIds ?? [interior.stationId])
    for (const id of covered) {
      const lead = leadById.get(id)
      if (lead !== undefined && !covered.has(lead)) {
        throw new Error(
          `stations/${interior.stationId}.json covers ${id} of complex ${lead} but not ${lead}; the map focuses the lead, so it would never show`,
        )
      }
    }
  }
}
