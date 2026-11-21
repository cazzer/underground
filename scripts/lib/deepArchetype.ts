/** Stations the classifier always calls `deep`, so no template is used for them: elevator- or escalator-only
 *  stations far below the street, whose levels no template models. Pinned by GTFS stop id from the catalog
 *  (data/stations/catalog/stations.json); names are for reading only. Unlike deepStations.ts this needs no
 *  depth or citation: it only keeps a station out of the generated set. Any E&E machine rising more than
 *  DEEP_RISE_M makes a station deep too (archetype.ts). */
import { parseRise } from './riseParse.ts'
import type { EquipmentFact } from './stationFacts.ts'

export const DEEP_REASON = 'deep station (docs/research/station-modeling.md archetypes table)'
/** 60 ft: the archetypes table's "elevator rise over 60 ft". */
export const DEEP_RISE_M = 18.3

export interface PinnedDeep {
  stationId: string
  name: string
}

export const PINNED_DEEP: readonly PinnedDeep[] = [
  { stationId: '110', name: '191 St' },
  { stationId: '111', name: '181 St (1)' },
  { stationId: '112', name: '168 St-Washington Hts (1)' },
  { stationId: '231', name: 'Clark St' },
  { stationId: '726', name: '34 St-Hudson Yards' },
  { stationId: 'A05', name: '190 St' },
  { stationId: 'A06', name: '181 St (A)' },
  { stationId: 'A09', name: '168 St (A, C)' },
  { stationId: 'B04', name: '21 St-Queensbridge' },
  { stationId: 'B06', name: 'Roosevelt Island' },
  { stationId: 'B08', name: 'Lexington Av/63 St' },
  { stationId: 'Q03', name: '72 St (Second Av)' },
  { stationId: 'Q04', name: '86 St (Second Av)' },
  { stationId: 'Q05', name: '96 St (Second Av)' },
]

/** The tallest parsable E&E rise in meters, with its machine; null when none parses. Unparsable rises are
 *  ignored here (depth.ts reports them). */
export function tallestRise(equipment: readonly EquipmentFact[]): { code: string; m: number } | null {
  let best: { code: string; m: number } | null = null
  for (const e of equipment) {
    if (e.rise === null) continue
    const r = parseRise(e.rise)
    if (r.ok && (!best || r.m > best.m)) best = { code: e.code, m: r.m }
  }
  return best
}
