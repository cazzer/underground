import { AMENITIES_FORMAT, type AmenitiesFile } from './amenitiesSchema'
import { fetchJson } from './loadNetwork'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Checks the shape of a fetched stations/amenities.json: the format, its text fields and every station's entry. */
export function expectAmenities(raw: unknown, url: string): AmenitiesFile {
  const fail = (why: string) => new Error(`${url}: not an amenities file (${why})`)
  if (!isRecord(raw)) throw fail('not an object')
  if (raw.format !== AMENITIES_FORMAT) throw fail(`format is ${JSON.stringify(raw.format)}, not ${AMENITIES_FORMAT}`)
  for (const key of ['attribution', 'restroomsUpdatedAt', 'restroomsMonth', 'cscRetrievedAt']) {
    if (typeof raw[key] !== 'string') throw fail(`${key} is not text`)
  }
  const { stations } = raw
  if (!isRecord(stations)) throw fail('no stations object')
  for (const [id, entry] of Object.entries(stations)) {
    if (!isRecord(entry)) throw fail(`station ${id} is not an object`)
    const { restrooms, csc } = entry
    if (restrooms !== undefined && !(Number.isInteger(restrooms) && (restrooms as number) > 0)) {
      throw fail(`station ${id} has restrooms ${JSON.stringify(restrooms)}, not a positive whole number`)
    }
    if (csc !== undefined && !(isRecord(csc) && typeof csc.entrance === 'string' && csc.entrance !== '')) {
      throw fail(`station ${id} has a customer service center with no entrance text`)
    }
    if (restrooms === undefined && csc === undefined) throw fail(`station ${id} lists no amenity`)
  }
  return raw as unknown as AmenitiesFile
}

/** Fetches `<baseUrl>data/stations/amenities.json`: each station's restroom and customer service center. */
export async function loadAmenities(baseUrl: string): Promise<AmenitiesFile> {
  const url = `${baseUrl}data/stations/amenities.json`
  return expectAmenities(await fetchJson(url), url)
}
