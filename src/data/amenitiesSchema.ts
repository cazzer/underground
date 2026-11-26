/**
 * public/data/stations/amenities.json, written by scripts/build-stations.ts from the pinned restroom list (data.ny.gov
 * 6yjv-fk7g, one month) and the hand-copied Customer Service Centers page: which stations have a public restroom and
 * which a customer service center, expanded to every member of the station's complex. It is fetched on demand (not at
 * startup, so it has its own size cap rather than the startup budget). MTA data under the OPEN-NY Terms of Use, not ODbL.
 * No imports: the scripts load this file with a `.ts` path.
 */
export const AMENITIES_FORMAT = 1

export interface StationAmenities {
  /** How many public restrooms the source lists in the station's complex (the source says nothing of where, or whether one is open). */
  restrooms?: number
  /** A staffed 24/7 customer service center in the complex; `entrance` is the MTA page's own text ("Enter at 42 St and 7 Av"). */
  csc?: { entrance: string }
}

export interface AmenitiesFile {
  format: typeof AMENITIES_FORMAT
  attribution: string
  /** The restroom dataset's own last-update time; the file carries no build time, so a rebuild with the same inputs is byte-identical. */
  restroomsUpdatedAt: string
  /** The restroom snapshot's month, `YYYY-MM-DD` (the first of the month). */
  restroomsMonth: string
  /** The date the customer service centers page was copied, `YYYY-MM-DD`. */
  cscRetrievedAt: string
  /** By GTFS station id: every member of a complex has the same entry. A station with neither amenity has no key. Key order is not an API. */
  stations: Record<string, StationAmenities>
}
