/** The committed public/data stations as the map's station groups (the tests' shared build; reads files, so tests only). */
import { readFileSync } from 'node:fs'
import type { RoutesFile, StationsFile } from '../data/schema'
import { stationAccess, type Station } from './network'
import { toGround } from './projection'
import { buildStationGroups, stationLeads } from './stationGroups'

const read = <T>(name: string): T => JSON.parse(readFileSync(`public/data/${name}`, 'utf8')) as T

export const realFile = read<StationsFile>('stations.json')
const routes = read<RoutesFile>('routes.json').routes
const shortName = new Map(routes.map((r) => [r.id, r.shortName]))
const leads = stationLeads(realFile.complexes ?? [], new Set(realFile.stations.map((s) => s.id)))

export const realStations = realFile.stations.map(
  (s): Station => ({
    id: s.id,
    name: s.name,
    pos: toGround(s),
    routeIds: s.routes,
    stops: s.stops,
    borough: s.borough,
    access: stationAccess(s),
    leadId: leads.get(s.id) ?? s.id,
  }),
)

export const { groups: realGroups, groupById: realGroupById } = buildStationGroups(
  realStations,
  realFile.complexes ?? [],
  new Map(routes.map((r, i) => [r.id, i])),
  (id) => shortName.get(id) ?? id,
)
