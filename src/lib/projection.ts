export interface LatLon {
  lat: number
  lon: number
}

/** Scene-space ground position in meters: x = east, z = south (so north is "up" in a top-down view). */
export interface Ground {
  x: number
  z: number
}

/** Reference point (City Hall area, lower Manhattan) that maps to the scene origin. */
export const REFERENCE: LatLon = { lat: 40.7128, lon: -74.006 }

const EARTH_RADIUS_M = 6_371_008.8
const DEG = Math.PI / 180

/** Scene x (meters east of `origin`) of a longitude; allocation-free, for per-vertex use. */
export function groundX(lon: number, origin: LatLon = REFERENCE): number {
  return (lon - origin.lon) * DEG * Math.cos(origin.lat * DEG) * EARTH_RADIUS_M
}

/** Scene z (meters south of `origin`) of a latitude; allocation-free, for per-vertex use. */
export function groundZ(lat: number, origin: LatLon = REFERENCE): number {
  return -(lat - origin.lat) * DEG * EARTH_RADIUS_M
}

/** Equirectangular projection around `origin`. Accurate to well under 1% across NYC. */
export function toGround(point: LatLon, origin: LatLon = REFERENCE): Ground {
  return { x: groundX(point.lon, origin), z: groundZ(point.lat, origin) }
}

export function toLatLon(ground: Ground, origin: LatLon = REFERENCE): LatLon {
  const north = -ground.z
  return {
    lat: origin.lat + north / EARTH_RADIUS_M / DEG,
    lon: origin.lon + ground.x / (EARTH_RADIUS_M * Math.cos(origin.lat * DEG)) / DEG,
  }
}
