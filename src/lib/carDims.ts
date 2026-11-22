/**
 * Car body dimensions in meters (carGeometry.ts draws them; the interior split reads the roof height).
 * No imports: scripts/lib/stationOutputs.test.ts (nodenext) loads this file through interiorGeometry.ts.
 */
export const CAR_WIDTH_M = 3
export const CAR_HEIGHT_M = 3.6
/** Height of the car floor above the track's drawn point (CarFrame.y); not scaled by the depth factor. */
export const CAR_FLOOR_M = 0.5
