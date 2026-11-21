/** Scores the archetype classifier over the whole station catalog. Offline; prints to stdout, writes nothing.
 *
 *    node scripts/score-archetypes.ts <feedDir> [--oracle <file>]
 *
 *  <feedDir> holds the 2021 draft NYCT GTFS pathways feed (stops.txt, pathways.txt). That feed must never
 *  be committed, shipped, or used as a source in public/data: it is read in place, only to cross-check the
 *  classifier. A feedDir inside this repository, or inside any git work tree, is refused. Tracks are the
 *  pinned OSM ways (the DOS Track LRS is not pinned). `--oracle` names the layout file to score against;
 *  the default is the tuning oracle, data/stations/layout-oracle.json. */
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyStation, INTERIOR_MIN_CONFIDENCE } from './lib/archetype.ts'
import { declinedReport, distribution, judge, oracleReport, pathwaysReport } from './lib/archetypeScore.ts'
import type { Classified } from './lib/archetypeScore.ts'
import { buildAllFacts } from './lib/catalogFacts.ts'
import type { Catalog } from './lib/catalogFacts.ts'
import type { CatalogEntrance, CatalogEquipment, CatalogStation, OsmCatalogWay } from './lib/catalogTypes.ts'
import { parseCsv } from './lib/csv.ts'
import { parseOracle, splitOracle } from './lib/layoutOracle.ts'
import { pathwaysTopology } from './lib/pathwaysTopology.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CATALOG = new URL('../data/stations/catalog/', import.meta.url)
const DEFAULT_ORACLE = fileURLToPath(new URL('../data/stations/layout-oracle.json', import.meta.url))

function usage(): never {
  throw new Error('usage: node scripts/score-archetypes.ts <feedDir> [--oracle <file>]')
}

/** True when `dir` is inside a git work tree. git exits non-zero outside one; any other failure (no git
 *  on the PATH) means we cannot tell, so it is raised rather than read as "outside". */
function insideGitWorkTree(dir: string): boolean {
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { stdio: 'ignore' })
    return true
  } catch (err) {
    if (typeof (err as { status?: unknown }).status === 'number') return false
    throw new Error(`cannot run git to check that ${dir} is outside every repository: ${String(err)}`)
  }
}

function parseArgs(args: string[]): { feedDir: string; oracle: string } {
  let oracle = DEFAULT_ORACLE
  const rest = [...args]
  const at = rest.indexOf('--oracle')
  if (at !== -1) {
    const file = rest[at + 1]
    if (file === undefined) usage()
    oracle = resolve(file)
    rest.splice(at, 2)
  }
  const [dir, ...extra] = rest
  if (dir === undefined || extra.length > 0) usage()
  const real = realpathSync.native(resolve(dir))
  const inside = relative(realpathSync.native(REPO_ROOT), real)
  const outside = inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)
  if (!outside || insideGitWorkTree(real)) {
    throw new Error(`${real} is inside a repository. The 2021 draft pathways feed must never be committed, shipped, or used as a source: keep it outside every git work tree.`)
  }
  return { feedDir: real, oracle }
}

const readJson = (url: URL | string): unknown => JSON.parse(readFileSync(url, 'utf8'))
const rowsOf = <T>(file: string): T[] => (readJson(new URL(file, CATALOG)) as { rows: T[] }).rows
const waysOf = (file: string): OsmCatalogWay[] => (readJson(new URL(file, CATALOG)) as { ways: OsmCatalogWay[] }).ways

function main(): void {
  const { feedDir, oracle: oracleFile } = parseArgs(process.argv.slice(2))
  const catalog: Catalog = {
    stations: rowsOf<CatalogStation>('stations.json'),
    entrances: rowsOf<CatalogEntrance>('entrances.json'),
    equipment: rowsOf<CatalogEquipment>('equipment.json'),
    platforms: waysOf('osm-platforms.json'),
    tracks: waysOf('osm-tracks.json'),
  }
  const all: Classified[] = buildAllFacts(catalog).map((f) => ({ stationId: f.stationId, name: f.name, result: classifyStation(f) }))
  const bar = INTERIOR_MIN_CONFIDENCE
  const byId = new Map(all.map((c) => [c.stationId, c]))
  const resultOf = (id: string, name: string) => {
    const c = byId.get(id)
    if (!c) throw new Error(`oracle station ${id} ${name} is not in the catalog`)
    return c.result
  }

  const { judged, declined } = splitOracle(parseOracle(readJson(oracleFile)))
  const outcomes = judged.map((o) => judge(o, resultOf(o.stationId, o.name)))
  const declinedResults = new Map(declined.map((d) => [d.stationId, resultOf(d.stationId, d.name)]))

  const read = (name: string) => readFileSync(resolve(feedDir, name), 'utf8')
  const topo = pathwaysTopology(
    parseCsv(read('stops.txt'), 'stops.txt', ['stop_id', 'location_type']),
    parseCsv(read('pathways.txt'), 'pathways.txt', ['from_stop_id', 'to_stop_id', 'pathway_mode']),
  )

  const out = [`Oracle file: ${relative(REPO_ROOT, oracleFile)}`, '', ...distribution(all, bar), '', ...oracleReport(outcomes, bar), '', ...declinedReport(declined, declinedResults, bar), '', ...pathwaysReport(all, topo)]
  process.stdout.write(`${out.join('\n')}\n`)
}

main()
