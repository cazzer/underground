/**
 * Stations that have a `public/data/stations/<id>.json` interior. Add an id here whenever
 * `npm run data:stations` writes a new file; scripts/lib/interiorRegistry.test.ts enforces it.
 * No imports: a scripts/ test (nodenext) loads this file.
 */
export const INTERIOR_STATION_IDS: readonly string[] = ['L08']

export function hasInterior(stationId: string): boolean {
  return INTERIOR_STATION_IDS.includes(stationId)
}
