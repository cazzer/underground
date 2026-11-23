/** The tests' check that a way in (`routesFromStreet`) never rides a one-way escalator against its travel. */
import type { StationInterior } from '../data/stationSchema'
import type { InStationRoute } from './interiorGraph'

/**
 * "ES219 ridden up" for each escalator a way-in route rides against its `travel`. A route lists the platform first, so
 * its connectors are walked from the platform's level; the rider takes them the other way, street to platform.
 */
export function escalatorsAgainstTravel(interior: StationInterior, routes: readonly InStationRoute[]): string[] {
  const out: string[] = []
  for (const route of routes) {
    const platform = interior.platforms.find((p) => p.id === route.areaIds[0])
    if (!platform) throw new Error(`No platform "${route.areaIds[0]}" in ${interior.stationId}`)
    let level = platform.level
    for (const id of route.connectorIds) {
      const c = interior.connectors.find((k) => k.id === id)
      if (!c) throw new Error(`No connector "${id}" in ${interior.stationId}`)
      if (c.lower.level !== level && c.upper.level !== level) throw new Error(`${id} has no end on level "${level}" of ${interior.stationId}`)
      // From the lower end outward, the rider comes down it.
      const riderGoes = c.lower.level === level ? 'down' : 'up'
      if (c.kind === 'escalator' && c.travel !== undefined && c.travel !== riderGoes) out.push(`${id} ridden ${riderGoes}`)
      level = c.lower.level === level ? c.upper.level : c.lower.level
    }
  }
  return out
}
