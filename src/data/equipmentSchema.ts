/**
 * public/data/stations/equipment.json, written by scripts/build-stations.ts from the pinned E&E inventory
 * (94fv-bak7) and station list (39hk-dx4f): every revenue elevator and escalator, and which stations list it. It is
 * fetched on the first station focus (not at startup, so it has its own size cap rather than the startup budget), and
 * only to name machines the focused interior doesn't draw. MTA data under the OPEN-NY Terms of Use, not ODbL.
 * No imports: the scripts load this file with a `.ts` path.
 */
export const EQUIPMENT_FORMAT = 1

export interface EquipmentMachine {
  kind: 'elevator' | 'escalator'
  /** The inventory's description ("Mezzanine to Manhattan-bound platform."), cleaned; null when it has none. */
  serving: string | null
}

export interface EquipmentIndexFile {
  format: typeof EQUIPMENT_FORMAT
  attribution: string
  /** The inventory's own last-update time; the file carries no build time, so a rebuild with the same inputs is byte-identical. */
  rowsUpdatedAt: string
  /** By equipment code ("EL371"), the Worker's /ene `code`. Written in code order; readers must not rely on key order. */
  machines: Record<string, EquipmentMachine>
  /** By GTFS station id: the codes of every machine in the complex, in code order. A station with none has no key. */
  stations: Record<string, string[]>
}
