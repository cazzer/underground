/** Does the station have a mezzanine between the street and the platform? Evidence in order:
 *  an E&E serving text that names one, the OSM level, the structure, then the entrance layout. */
import { distanceToRing } from './stationGeometry.ts'
import type { PlatformLayout } from './platformLayout.ts'
import type { StationFacts } from './stationFacts.ts'

/** A side platform entered directly from the street has its entrances this close to its polygon. */
const DIRECT_ENTRANCE_M = 6
const ASSUMED_PENALTY = 0.1

export interface MezzanineEvidence {
  value: boolean
  /** Subtracted from the confidence. */
  penalty: number
  reason: string
}

export function mezzanineEvidence(f: StationFacts, platformLevel: number | null, layouts: PlatformLayout[]): MezzanineEvidence {
  const named = f.equipment.find((e) => /mezzanine/i.test(e.serving))
  if (named) return { value: true, penalty: 0, reason: `mezzanine: ${named.code} serving text names one` }
  if (f.structure !== 'subway' && f.structure !== 'elevated' && f.structure !== 'viaduct') return { value: false, penalty: 0, reason: `no mezzanine: the ${f.structure} station is open to the street` }
  if (platformLevel !== null && platformLevel <= -2) return { value: true, penalty: 0, reason: `mezzanine: OSM level ${platformLevel} leaves room for one` }
  if (platformLevel === -1) return { value: false, penalty: 0, reason: 'no mezzanine: OSM level -1 is one floor down' }
  if (f.structure === 'elevated' || f.structure === 'viaduct') return { value: true, penalty: 0, reason: `mezzanine: ${f.structure} stations default to a mezzanine under the tracks` }
  const sideWays = new Set(layouts.filter((l) => l.kind === 'side').flatMap((l) => l.osmWays))
  const sidePolygons = f.platforms.filter((p) => sideWays.has(p.osmWay))
  if (sidePolygons.length > 0 && f.entrances.some((e) => sidePolygons.some((p) => distanceToRing(e.at, p.outline) <= DIRECT_ENTRANCE_M))) {
    return { value: false, penalty: 0, reason: `no mezzanine: an entrance is within ${DIRECT_ENTRANCE_M} m of a side platform` }
  }
  return { value: true, penalty: ASSUMED_PENALTY, reason: `mezzanine assumed (no evidence either way): -${ASSUMED_PENALTY}` }
}
