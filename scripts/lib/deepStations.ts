/** Stations whose platform depth below the street is published by a citable source.
 *  An entry needs a real citation; do not add a number from memory or an estimate.
 *  Empty on purpose for now: no depth has been verified against a primary source yet. A deep station
 *  without an entry here still gets a depth from its E&E rise or its OSM level. */
export interface DeepStation {
  stationId: string
  /** Platform elevation relative to the street in meters (negative below). */
  platformY: number
  citation: string
}

export const DEEP_STATIONS: DeepStation[] = []
