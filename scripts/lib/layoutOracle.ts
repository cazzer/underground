/** data/stations/layout-oracle.json and layout-holdout.json: station layouts agent-checked against English
 *  Wikipedia (not by a person), used only to score the archetype classifier offline. Not shipped, no
 *  article text copied. Validated at load. */
import { finite, list, oneOf, record, text } from './check.ts'

export interface OracleComponent {
  line: string
  platformType: 'island' | 'side' | 'mixed'
  platforms: number
  tracks: number
}

export interface OracleStation {
  /** GTFS parent stop id, as in data/stations/catalog/stations.json. */
  stationId: string
  name: string
  platformType: 'island' | 'side' | 'mixed'
  /** Physical platforms in service (an island is one). */
  platforms: number
  /** Physical tracks at the platforms. */
  tracks: number
  /** True when the article describes a level separate from the platforms that connects both directions,
   *  false when it says there is none or fare control is only at platform level, null when it is silent
   *  (the file header's `mezzanineRule`). */
  mezzanine: boolean | null
  /** Platforms on more than one level: the classifier should decline it. */
  multiLevel?: boolean
  /** Shares platforms or levels with other stations: the classifier should decline it. */
  complex?: boolean
  /** Tracks in revenue service, when fewer than `tracks`. */
  tracksInService?: number
  abandonedPlatforms?: number
  /** For a complex: the layout of each line. The top-level fields describe the row's own line. */
  components?: OracleComponent[]
  /** The article gives a platform depth (a deep station). */
  deep?: boolean
  /** Sampling bookkeeping for the held-out file. */
  catalogStructure?: string
  stratum?: string
  /** A short paraphrase of the fact, not article text. */
  note?: string
  /** English Wikipedia page title. */
  article: string
  /** Wikipedia revision id the facts were read from. */
  revision: number
}

/** Stations whose layout the classifier should decline (not reach the confidence bar): a complex sharing
 *  platforms or levels with other stations, or a station with platforms on more than one level. */
export interface DeclinedStation {
  stationId: string
  name: string
  reason: 'complex' | 'multi-level'
  article: string
  revision: number
}

export interface LayoutOracle {
  about: string
  sourceLicense: 'CC BY-SA 4.0'
  verifiedBy: string
  retrievedAt: string
  mezzanineRule?: string
  method?: string
  stations: OracleStation[]
  declined: DeclinedStation[]
}

const KINDS = ['island', 'side', 'mixed'] as const

function positiveInt(v: unknown, path: string): number {
  const n = finite(v, path)
  if (!Number.isInteger(n) || n < 1) throw new Error(`${path}: expected a positive integer, got ${n}`)
  return n
}

function optionalText(v: unknown, path: string): string | undefined {
  return v === undefined ? undefined : text(v, path)
}

function optionalBool(v: unknown, path: string): boolean | undefined {
  if (v !== undefined && typeof v !== 'boolean') throw new Error(`${path}: expected a boolean, got ${JSON.stringify(v)}`)
  return v
}

function component(raw: unknown, at: string): OracleComponent {
  const c = record(raw, at)
  return { line: text(c.line, `${at}.line`), platformType: oneOf(c.platformType, KINDS, `${at}.platformType`), platforms: positiveInt(c.platforms, `${at}.platforms`), tracks: positiveInt(c.tracks, `${at}.tracks`) }
}

export function parseOracle(json: unknown): LayoutOracle {
  const root = record(json, 'oracle')
  const seen = new Set<string>()
  const claim = (id: string, at: string): string => {
    if (seen.has(id)) throw new Error(`${at}.stationId: duplicate ${id}`)
    seen.add(id)
    return id
  }
  const stations = list(root.stations, 'oracle.stations').map((raw, i): OracleStation => {
    const at = `oracle.stations[${i}]`
    const s = record(raw, at)
    if (s.mezzanine !== null && typeof s.mezzanine !== 'boolean') throw new Error(`${at}.mezzanine: expected true, false or null, got ${JSON.stringify(s.mezzanine)}`)
    const multiLevel = optionalBool(s.multiLevel, `${at}.multiLevel`)
    const complex = optionalBool(s.complex, `${at}.complex`)
    const inService = s.tracksInService === undefined ? undefined : positiveInt(s.tracksInService, `${at}.tracksInService`)
    const abandoned = s.abandonedPlatforms === undefined ? undefined : positiveInt(s.abandonedPlatforms, `${at}.abandonedPlatforms`)
    const note = optionalText(s.note, `${at}.note`)
    const deep = optionalBool(s.deep, `${at}.deep`)
    const catalogStructure = optionalText(s.catalogStructure, `${at}.catalogStructure`)
    const stratum = optionalText(s.stratum, `${at}.stratum`)
    return {
      stationId: claim(text(s.stationId, `${at}.stationId`), at),
      name: text(s.name, `${at}.name`),
      platformType: oneOf(s.platformType, KINDS, `${at}.platformType`),
      platforms: positiveInt(s.platforms, `${at}.platforms`),
      tracks: positiveInt(s.tracks, `${at}.tracks`),
      mezzanine: s.mezzanine,
      ...(multiLevel === undefined ? {} : { multiLevel }),
      ...(complex === undefined ? {} : { complex }),
      ...(inService === undefined ? {} : { tracksInService: inService }),
      ...(abandoned === undefined ? {} : { abandonedPlatforms: abandoned }),
      ...(s.components === undefined ? {} : { components: list(s.components, `${at}.components`).map((c, k) => component(c, `${at}.components[${k}]`)) }),
      ...(deep === undefined ? {} : { deep }),
      ...(catalogStructure === undefined ? {} : { catalogStructure }),
      ...(stratum === undefined ? {} : { stratum }),
      ...(note === undefined ? {} : { note }),
      article: text(s.article, `${at}.article`),
      revision: positiveInt(s.revision, `${at}.revision`),
    }
  })
  const declined = list(root.declined, 'oracle.declined').map((raw, i): DeclinedStation => {
    const at = `oracle.declined[${i}]`
    const d = record(raw, at)
    return {
      stationId: claim(text(d.stationId, `${at}.stationId`), at),
      name: text(d.name, `${at}.name`),
      reason: oneOf(d.reason, ['complex', 'multi-level'], `${at}.reason`),
      article: text(d.article, `${at}.article`),
      revision: positiveInt(d.revision, `${at}.revision`),
    }
  })
  const mezzanineRule = optionalText(root.mezzanineRule, 'oracle.mezzanineRule')
  const method = optionalText(root.method, 'oracle.method')
  return {
    about: text(root.about, 'oracle.about'),
    sourceLicense: oneOf(root.sourceLicense, ['CC BY-SA 4.0'], 'oracle.sourceLicense'),
    verifiedBy: text(root.verifiedBy, 'oracle.verifiedBy'),
    retrievedAt: text(root.retrievedAt, 'oracle.retrievedAt'),
    ...(mezzanineRule === undefined ? {} : { mezzanineRule }),
    ...(method === undefined ? {} : { method }),
    stations,
    declined,
  }
}

/** The stations to judge for layout, and those expected to stay below the bar: `declined` plus any
 *  station flagged complex or multiLevel. */
export function splitOracle(o: LayoutOracle): { judged: OracleStation[]; declined: DeclinedStation[] } {
  const flagged = o.stations.filter((s) => s.complex === true || s.multiLevel === true)
  return {
    judged: o.stations.filter((s) => !flagged.includes(s)),
    declined: [
      ...o.declined,
      ...flagged.map((s): DeclinedStation => ({ stationId: s.stationId, name: s.name, reason: s.complex === true ? 'complex' : 'multi-level', article: s.article, revision: s.revision })),
    ],
  }
}
