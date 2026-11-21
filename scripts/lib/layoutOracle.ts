/** data/stations/layout-oracle.json: station layouts checked by hand against English Wikipedia, used only to
 *  score the archetype classifier offline. Not shipped, no article text copied. Validated at load. */
import { finite, list, oneOf, record, text } from './check.ts'

export interface OracleStation {
  /** GTFS parent stop id, as in data/stations/catalog/stations.json. */
  stationId: string
  name: string
  platformType: 'island' | 'side' | 'mixed'
  /** Physical platforms (an island is one). */
  platforms: number
  tracks: number
  /** True when the article describes a mezzanine between street and platform, false when it says fare
   *  control is at platform level, null when it does not say. */
  mezzanine: boolean | null
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
  license: 'CC BY-SA 4.0'
  verifiedBy: string
  retrievedAt: string
  stations: OracleStation[]
  declined: DeclinedStation[]
}

export function parseOracle(json: unknown): LayoutOracle {
  const root = record(json, 'oracle')
  const seen = new Set<string>()
  const stations = list(root.stations, 'oracle.stations').map((raw, i): OracleStation => {
    const at = `oracle.stations[${i}]`
    const s = record(raw, at)
    const stationId = text(s.stationId, `${at}.stationId`)
    if (seen.has(stationId)) throw new Error(`${at}.stationId: duplicate ${stationId}`)
    seen.add(stationId)
    const platforms = finite(s.platforms, `${at}.platforms`)
    const tracks = finite(s.tracks, `${at}.tracks`)
    const revision = finite(s.revision, `${at}.revision`)
    for (const [k, v] of [['platforms', platforms], ['tracks', tracks], ['revision', revision]] as const) {
      if (!Number.isInteger(v) || v < 1) throw new Error(`${at}.${k}: expected a positive integer, got ${v}`)
    }
    if (s.mezzanine !== null && typeof s.mezzanine !== 'boolean') throw new Error(`${at}.mezzanine: expected true, false or null, got ${JSON.stringify(s.mezzanine)}`)
    return {
      stationId,
      name: text(s.name, `${at}.name`),
      platformType: oneOf(s.platformType, ['island', 'side', 'mixed'], `${at}.platformType`),
      platforms,
      tracks,
      mezzanine: s.mezzanine,
      article: text(s.article, `${at}.article`),
      revision,
    }
  })
  const declined = list(root.declined, 'oracle.declined').map((raw, i): DeclinedStation => {
    const at = `oracle.declined[${i}]`
    const d = record(raw, at)
    const stationId = text(d.stationId, `${at}.stationId`)
    if (seen.has(stationId)) throw new Error(`${at}.stationId: duplicate ${stationId}`)
    seen.add(stationId)
    const revision = finite(d.revision, `${at}.revision`)
    if (!Number.isInteger(revision) || revision < 1) throw new Error(`${at}.revision: expected a positive integer, got ${revision}`)
    return { stationId, name: text(d.name, `${at}.name`), reason: oneOf(d.reason, ['complex', 'multi-level'], `${at}.reason`), article: text(d.article, `${at}.article`), revision }
  })
  return {
    about: text(root.about, 'oracle.about'),
    license: oneOf(root.license, ['CC BY-SA 4.0'], 'oracle.license'),
    verifiedBy: text(root.verifiedBy, 'oracle.verifiedBy'),
    retrievedAt: text(root.retrievedAt, 'oracle.retrievedAt'),
    stations,
    declined,
  }
}
