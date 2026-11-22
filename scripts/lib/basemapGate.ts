/** The licensing and schema gate over a PMTiles archive's metadata (`pmtiles show --metadata`).
 *
 *  The basemap's terms were reviewed against one Protomaps build (data/basemap/source-metadata.20261121.json): the
 *  footer's OpenStreetMap credit covers earth, water, landuse and roads. Anything else the metadata names (another
 *  credit, a new layer or key, a new major schema) is unreviewed, so the gate fails and the workflow stops for a
 *  licensing decision instead of publishing it. `source` checks the extract as cut from the daily build; `output`
 *  checks what tile-join wrote (it rewrites `version`, so that is not checked there). */
import { list, record, text } from './check.ts'
import type { BasemapSpec } from './basemapSpec.ts'

export type GateStage = 'source' | 'output'

/** The credit text the footer already carries. Protomaps' own attribution link wraps exactly this. */
const ALLOWED_ATTRIBUTION = '© OpenStreetMap'
/** Names Natural Earth (public domain) next to OSM; a change here means the sources changed. */
const REVIEWED_DESCRIPTION = 'Basemap layers derived from OpenStreetMap and Natural Earth'
const REVIEWED_MAJOR_VERSION = 4
const SOURCE_KEYS = ['vector_layers', 'attribution', 'description', 'name', 'type', 'version']
const SOURCE_KEY_PREFIXES = ['planetiler:', 'pgf:']

/** The attribution's visible text: tags removed, `&copy;` read as ©. */
export function attributionText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&copy;/gi, '©').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function layerIds(meta: Record<string, unknown>): string[] {
  return list(meta.vector_layers, 'metadata.vector_layers').map((l, i) => text(record(l, `metadata.vector_layers[${i}]`).id, `metadata.vector_layers[${i}].id`))
}

/** Every reason the metadata may not be published; empty when it passes. Throws only if the metadata isn't the expected shape. */
export function gateProblems(metadata: unknown, spec: BasemapSpec, stage: GateStage): string[] {
  const meta = record(metadata, 'metadata')
  const problems: string[] = []

  const attribution = attributionText(text(meta.attribution, 'metadata.attribution'))
  if (attribution !== ALLOWED_ATTRIBUTION) {
    problems.push(`attribution is "${attribution}", not "${ALLOWED_ATTRIBUTION}": a new credit needs a licensing decision`)
  }
  const description = text(meta.description, 'metadata.description')
  if (description !== REVIEWED_DESCRIPTION) {
    problems.push(`description is "${description}", not the reviewed "${REVIEWED_DESCRIPTION}": its sources changed`)
  }

  const ids = layerIds(meta)
  const missing = spec.layers.filter((l) => !ids.includes(l))
  if (missing.length > 0) problems.push(`kept layer ${missing.join(', ')} is missing`)

  if (stage === 'source') {
    const version = text(meta.version, 'metadata.version')
    if (Number.parseInt(version, 10) !== REVIEWED_MAJOR_VERSION || !/^\d+\.\d+\.\d+$/.test(version)) {
      problems.push(`basemap version is ${version}, reviewed only for ${REVIEWED_MAJOR_VERSION}.x: the layer schema may have changed`)
    }
    const unreviewed = ids.filter((l) => !spec.layers.includes(l) && !spec.dropLayers.includes(l))
    if (unreviewed.length > 0) problems.push(`layer ${unreviewed.join(', ')} is new: its sources and credits are unreviewed`)
    const keys = Object.keys(meta).filter((k) => !SOURCE_KEYS.includes(k) && !SOURCE_KEY_PREFIXES.some((p) => k.startsWith(p)))
    if (keys.length > 0) problems.push(`metadata key ${keys.join(', ')} is new: it may carry a credit`)
  } else {
    const extra = ids.filter((l) => !spec.layers.includes(l))
    if (extra.length > 0) problems.push(`layer ${extra.join(', ')} should have been dropped`)
  }
  return problems
}

export function assertGate(metadata: unknown, spec: BasemapSpec, stage: GateStage): void {
  const problems = gateProblems(metadata, spec, stage)
  if (problems.length > 0) throw new Error(`basemap ${stage} metadata fails the licensing gate:\n- ${problems.join('\n- ')}`)
}
