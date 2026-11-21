/** Scores the archetype classifier over the whole station catalog. Offline; prints to stdout, writes nothing.
 *
 *    node scripts/score-archetypes.ts <feedDir> [--tracks osm]
 *
 *  <feedDir> holds the 2021 draft NYCT GTFS pathways feed (stops.txt, pathways.txt). That feed must never
 *  be committed, shipped, or used as a source in public/data: it is read in place, only to cross-check the
 *  classifier, and a feedDir inside this repository is refused. Tracks are the pinned OSM ways; the DOS
 *  Track LRS is not pinned, so `osm` is the only choice. */
import { readFileSync, realpathSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyStation, INTERIOR_MIN_CONFIDENCE } from './lib/archetype.ts'
import { declinedReport, distribution, judge, oracleReport, pathwaysReport } from './lib/archetypeScore.ts'
import type { Classified } from './lib/archetypeScore.ts'
import { buildAllFacts } from './lib/catalogFacts.ts'
import type { Catalog } from './lib/catalogFacts.ts'
import type { CatalogEntrance, CatalogEquipment, CatalogStation, OsmCatalogWay } from './lib/catalogTypes.ts'
import { parseCsv } from './lib/csv.ts'
import { parseOracle } from './lib/layoutOracle.ts'
import { pathwaysTopology } from './lib/pathwaysTopology.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CATALOG = new URL('../data/stations/catalog/', import.meta.url)

function usage(): never {
  throw new Error('usage: node scripts/score-archetypes.ts <feedDir> [--tracks osm]')
}

function feedDirFrom(args: string[]): string {
  const tracksAt = args.indexOf('--tracks')
  if (tracksAt !== -1) {
    if (args[tracksAt + 1] !== 'osm') throw new Error('--tracks: only "osm" is available (the DOS Track LRS is not pinned)')
    args = args.filter((_, i) => i !== tracksAt && i !== tracksAt + 1)
  }
  const [dir, ...rest] = args
  if (dir === undefined || rest.length > 0) usage()
  const real = realpathSync(resolve(dir))
  const inside = relative(realpathSync(REPO_ROOT), real)
  if (inside === '' || (!inside.startsWith('..') && !inside.startsWith(sep))) {
    throw new Error(`${real} is inside the repository. The 2021 draft pathways feed must never be committed, shipped, or used as a source: keep it outside the repo.`)
  }
  return real
}

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))
const rowsOf = <T>(file: string): T[] => (readJson(new URL(file, CATALOG)) as { rows: T[] }).rows
const waysOf = (file: string): OsmCatalogWay[] => (readJson(new URL(file, CATALOG)) as { ways: OsmCatalogWay[] }).ways

function main(): void {
  const feedDir = feedDirFrom(process.argv.slice(2))
  const catalog: Catalog = {
    stations: rowsOf<CatalogStation>('stations.json'),
    entrances: rowsOf<CatalogEntrance>('entrances.json'),
    equipment: rowsOf<CatalogEquipment>('equipment.json'),
    platforms: waysOf('osm-platforms.json'),
    tracks: waysOf('osm-tracks.json'),
  }
  const all: Classified[] = buildAllFacts(catalog).map((f) => ({ stationId: f.stationId, name: f.name, result: classifyStation(f) }))
  const bar = INTERIOR_MIN_CONFIDENCE

  const oracle = parseOracle(readJson(new URL('../data/stations/layout-oracle.json', import.meta.url)))
  const byId = new Map(all.map((c) => [c.stationId, c]))
  const outcomes = oracle.stations.map((o) => {
    const c = byId.get(o.stationId)
    if (!c) throw new Error(`oracle station ${o.stationId} ${o.name} is not in the catalog`)
    return judge(o, c.result)
  })

  const resultOf = (id: string, name: string) => {
    const c = byId.get(id)
    if (!c) throw new Error(`oracle station ${id} ${name} is not in the catalog`)
    return c.result
  }
  const declinedResults = new Map(oracle.declined.map((d) => [d.stationId, resultOf(d.stationId, d.name)]))

  const read = (name: string) => readFileSync(resolve(feedDir, name), 'utf8')
  const topo = pathwaysTopology(
    parseCsv(read('stops.txt'), 'stops.txt', ['stop_id', 'location_type']),
    parseCsv(read('pathways.txt'), 'pathways.txt', ['from_stop_id', 'to_stop_id', 'pathway_mode']),
  )

  const out = [...distribution(all, bar), '', ...oracleReport(outcomes, bar), '', ...declinedReport(oracle.declined, declinedResults, bar), '', ...pathwaysReport(all, topo)]
  process.stdout.write(`${out.join('\n')}\n`)
}

main()
