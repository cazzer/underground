/**
 * TEMPORARY, dev only (`?machinesDemo`), removed with machineLook.ts after the 9wc.8 look card.
 * Bedford Av has no escalators, so this swaps two of its platform stairs for escalators (one with a
 * travel direction, one reversible), adds an inventory-style escalator with no run of its own, and a
 * platform-to-street elevator that passes the mezzanine without stopping. Not real data.
 */
import type { Connector, StationInterior } from './stationSchema'

const DEMO_STATION = 'L08'

const ESCALATORS: Record<string, Connector['travel'] | null> = {
  'st-platform-west-1': 'up',
  'st-platform-east': null,
}

const ADDED: Connector[] = [
  {
    id: 'ES-DEMO',
    kind: 'escalator',
    lower: { x: 52, z: 43, level: 'mezzanine' },
    upper: { x: 52, z: 43, level: 'street' },
    width: 1.2,
    travel: 'down',
    sources: ['authored'],
  },
  {
    id: 'EL-DEMO',
    kind: 'elevator',
    lower: { x: 30, z: 24.84, level: 'platform' },
    upper: { x: 30, z: 24.84, level: 'street' },
    width: 2,
    sources: ['authored'],
  },
]

export function withDemoMachines(interior: StationInterior): StationInterior {
  if (interior.stationId !== DEMO_STATION) return interior
  const connectors = interior.connectors.map((c): Connector => {
    if (!(c.id in ESCALATORS)) return c
    const travel = ESCALATORS[c.id]
    return { ...c, kind: 'escalator', width: 1.2, ...(travel ? { travel } : {}) }
  })
  return { ...interior, connectors: [...connectors, ...ADDED].sort((a, b) => a.id.localeCompare(b.id)) }
}
