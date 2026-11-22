import { readFileSync } from 'node:fs'
import type { Candidate } from './geocodeCandidate'
import { trimGeoSearch } from './geosearch'
import { trimPhoton } from './photon'

/** The recorded answers in fixtures/geocode.json (see fixtures/README.md); tests only. */
const fixture = JSON.parse(readFileSync(new URL('../fixtures/geocode.json', import.meta.url), 'utf8')) as {
  geosearch: Record<string, unknown>
  photon: Record<string, unknown>
}

export const recordedGeoSearch = (query: string): unknown => fixture.geosearch[query]
export const recordedPhoton = (query: string): unknown => fixture.photon[query]
export const geoSearchCandidates = (query: string): Candidate[] => trimGeoSearch(recordedGeoSearch(query)).candidates
export const photonCandidates = (query: string): Candidate[] => trimPhoton(recordedPhoton(query)).candidates

/** A one-row GeoJSON collection with the given [lon, lat] and properties. */
export function feature(lon: number, lat: number, properties: Record<string, unknown>): unknown {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties }
}

export const collection = (...features: unknown[]): unknown => ({ type: 'FeatureCollection', features })
