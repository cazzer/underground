/** The MTA's subway Customer Service Centers (data/stations/customer-service-centers.json), copied by
 *  hand from https://www.mta.info/contact-us/customer-service-centers. Not an open dataset: the page
 *  is the only source and the list has no refresh path, so it goes stale. Nothing ships from it yet. */

export interface CustomerServiceCenter {
  /** GTFS stop id of the catalog station (for a complex, one member; the build expands to the rest). */
  gtfsStopId: string
  /** The catalog's name for that stop. */
  name: string
  /** The station as the page writes it. */
  pageName: string
  /** The page's entrance text, verbatim ("Enter at 42 St and 7 Av"); the page gives none for St George. */
  entrance?: string
  /** Set only where the center is not staffed 24/7 (St George). */
  hours?: string
}

export interface CustomerServiceCenters {
  source: string
  retrievedAt: string
  about: string
  centers: CustomerServiceCenter[]
}

const FILE = 'data/stations/customer-service-centers.json'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function text(where: string, o: Record<string, unknown>, key: string): string {
  const v = o[key]
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${where}: "${key}" must be a non-empty string`)
  return v
}

/** Checks the shape of the parsed file and that no stop id is listed twice; whether the ids and names
 *  are the catalog's is the test's job. */
export function parseCustomerServiceCenters(value: unknown): CustomerServiceCenters {
  if (!isRecord(value)) throw new Error(`${FILE} must be an object`)
  const source = text(FILE, value, 'source')
  const about = text(FILE, value, 'about')
  const retrievedAt = text(FILE, value, 'retrievedAt')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt)) throw new Error(`${FILE}: "retrievedAt" must be YYYY-MM-DD`)
  if (!Array.isArray(value.centers) || value.centers.length === 0) throw new Error(`${FILE}: "centers" must be a non-empty array`)
  const seen = new Set<string>()
  const centers = value.centers.map((c: unknown, i: number): CustomerServiceCenter => {
    const where = `${FILE} centers[${i}]`
    if (!isRecord(c)) throw new Error(`${where}: must be an object`)
    const extra = Object.keys(c).filter((k) => !['gtfsStopId', 'name', 'pageName', 'entrance', 'hours'].includes(k))
    if (extra.length > 0) throw new Error(`${where}: unknown key ${extra.join(', ')}`)
    const gtfsStopId = text(where, c, 'gtfsStopId')
    if (seen.has(gtfsStopId)) throw new Error(`${where}: duplicate gtfsStopId ${gtfsStopId}`)
    seen.add(gtfsStopId)
    const out: CustomerServiceCenter = { gtfsStopId, name: text(where, c, 'name'), pageName: text(where, c, 'pageName') }
    if (c.entrance !== undefined) out.entrance = text(where, c, 'entrance')
    if (c.hours !== undefined) out.hours = text(where, c, 'hours')
    return out
  })
  return { source, retrievedAt, about, centers }
}
