/**
 * TEMPORARY until generated interiors are labelled as such in the panel (9wc.5).
 * `?generated=1` shows generated station interiors: without it the client treats index entries with
 * `provenance: 'generated'` as not listed and never fetches stations/depths-generated.json. With it, generated
 * interiors load like authored ones and the map's tracks descend to their depths. Never import this anywhere
 * but useStationInterior.ts and useNetwork.ts: it reads `window`. Once 9wc.5 lands, remove together:
 * - this file, and its uses in src/data/useStationInterior.ts and src/data/useNetwork.ts
 * - `withoutGenerated` in src/data/loadStationIndex.ts (and its test), if every entry is shown from then on
 * - the `generatedDepths` flag of `loadNetwork`. Under the flag the file is fetched in the startup batch, so the
 *   network is built once. Without the flag it must either join the startup budget or arrive late; late needs the
 *   track profiles to change without a new Network or profiles identity (CameraRig refits the city and
 *   useRealtimeStatic refetches its join data when either changes)
 * - `mergeStationDepths` in loadNetwork.ts, if depths-generated.json is folded into station-depths.json
 * - AGENTS.md: the `?generated=` TEMPORARY note and generatedLook.ts in the directory map
 */

export function resolveGeneratedLook(search: string): boolean {
  return new URLSearchParams(search).get('generated') === '1'
}

/** True when generated interiors and their depths are shown. */
export const showGenerated: boolean = resolveGeneratedLook(window.location.search)
