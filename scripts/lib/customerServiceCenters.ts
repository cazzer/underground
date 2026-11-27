/** The MTA's subway Customer Service Centers (data/stations/customer-service-centers.json), copied by
 *  hand from https://www.mta.info/contact-us/customer-service-centers. Not an open dataset: the page
 *  is the only source and the list has no refresh path, so it goes stale. Every entry is staffed 24/7
 *  (the page's own words); a center with other hours is left out. `npm run data:stations` ships it in public/data/stations/amenities.json. */
import { list, onlyKeys, record, text } from './check.ts'

export interface CustomerServiceCenter {
  /** GTFS stop id of the catalog station. For a complex it is one member, not necessarily the
   *  stations.json lead, so the build must expand it through the complex. */
  gtfsStopId: string
  /** The catalog's name for that stop. */
  name: string
  /** The station as the page writes it. */
  pageName: string
  /** The page's entrance text, verbatim ("Enter at 42 St and 7 Av"). */
  entrance: string
}

export interface CustomerServiceCenters {
  source: string
  retrievedAt: string
  about: string
  centers: CustomerServiceCenter[]
}

const FILE = 'customer-service-centers.json'

function realDate(v: string, path: string): string {
  const d = new Date(`${v}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new Error(`${path}: expected a real YYYY-MM-DD date, got ${JSON.stringify(v)}`)
  }
  return v
}

/** Checks the shape of the parsed file and that no stop id is listed twice; whether the ids and names
 *  are the catalog's is the test's job. */
export function parseCustomerServiceCenters(value: unknown): CustomerServiceCenters {
  const o = record(value, FILE)
  onlyKeys(o, ['source', 'retrievedAt', 'about', 'centers'], FILE)
  const centers = list(o.centers, `${FILE} centers`)
  if (centers.length === 0) throw new Error(`${FILE} centers: expected at least one center`)
  const seen = new Set<string>()
  return {
    source: text(o.source, `${FILE} source`),
    retrievedAt: realDate(text(o.retrievedAt, `${FILE} retrievedAt`), `${FILE} retrievedAt`),
    about: text(o.about, `${FILE} about`),
    centers: centers.map((c, i): CustomerServiceCenter => {
      const where = `${FILE} centers[${i}]`
      const r = record(c, where)
      onlyKeys(r, ['gtfsStopId', 'name', 'pageName', 'entrance'], where)
      const gtfsStopId = text(r.gtfsStopId, `${where}.gtfsStopId`)
      if (seen.has(gtfsStopId)) throw new Error(`${where}: duplicate gtfsStopId ${gtfsStopId}`)
      seen.add(gtfsStopId)
      return {
        gtfsStopId,
        name: text(r.name, `${where}.name`),
        pageName: text(r.pageName, `${where}.pageName`),
        entrance: text(r.entrance, `${where}.entrance`),
      }
    }),
  }
}
