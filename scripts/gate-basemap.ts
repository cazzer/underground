/** The basemap workflow's licensing and schema gate (scripts/lib/basemapGate.ts), over `pmtiles show --metadata` output.
 *
 *  node scripts/gate-basemap.ts <source|output> <metadata.json>
 *
 *  Offline. Exits 1, naming every reason, when the metadata is not what the terms were reviewed for; the workflow
 *  then stops before publishing, and the finding goes to a person as a licensing card. */
import { readFileSync } from 'node:fs'
import { assertGate } from './lib/basemapGate.ts'
import type { GateStage } from './lib/basemapGate.ts'
import { parseBasemapFile } from './lib/basemapSpec.ts'
import { oneOf } from './lib/check.ts'

const FILE = new URL('../data/basemap/basemap.json', import.meta.url)

function main(): void {
  const [stageArg, metadataPath] = process.argv.slice(2)
  if (stageArg === undefined || metadataPath === undefined) throw new Error('usage: node scripts/gate-basemap.ts <source|output> <metadata.json>')
  const stage: GateStage = oneOf(stageArg, ['source', 'output'], 'stage')
  const { spec } = parseBasemapFile(JSON.parse(readFileSync(FILE, 'utf8')))
  assertGate(JSON.parse(readFileSync(metadataPath, 'utf8')), spec, stage)
  console.log(`basemap ${stage} metadata passes the licensing gate (layers ${spec.layers.join(', ')}; credit "© OpenStreetMap")`)
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
