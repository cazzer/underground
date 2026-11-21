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

/** Equirectangular projection around `origin`. Accurate to well under 1% across NYC. */
export function toGround(point: LatLon, origin: LatLon = REFERENCE): Ground {
  const east = (point.lon - origin.lon) * DEG * Math.cos(origin.lat * DEG) * EARTH_RADIUS_M
  const north = (point.lat - origin.lat) * DEG * EARTH_RADIUS_M
  return { x: east, z: -north }
}

export function toLatLon(ground: Ground, origin: LatLon = REFERENCE): LatLon {
  const north = -ground.z
  return {
    lat: origin.lat + north / EARTH_RADIUS_M / DEG,
    lon: origin.lon + ground.x / (EARTH_RADIUS_M * Math.cos(origin.lat * DEG)) / DEG,
  }
}
