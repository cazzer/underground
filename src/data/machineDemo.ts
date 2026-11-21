/**
 * TEMPORARY, dev only (`?machinesDemo`), removed with machineLook.ts after the 9wc.8 look card.
 * Bedford Av has no escalators, so this swaps two of its platform stairs for escalators (one with a
 * travel direction, one reversible), adds an inventory-style escalator with no run of its own, a
 * platform-to-street elevator that passes the mezzanine without stopping, and a bank of two
 * inventory-style escalators at one added street entrance (9wc.9). Not real data.
 */
import type { Connector, Entrance, StationInterior } from './stationSchema'

const DEMO_STATION = 'L08'

const ESCALATORS: Record<string, Connector['travel'] | null> = {
  'st-platform-west-1': 'up',
  'st-platform-east': null,
}

/** Bank escalators sit on the entrance point, as the station build places a listed inventory machine. */
const BANK: Entrance = {
  id: 'demo-bank',
  x: -68,
  z: -40,
  type: 'Escalator',
  entry: true,
  exit: true,
  connectors: ['ES-DEMO-B1', 'ES-DEMO-B2'],
  sources: ['authored'],
}

const bankEscalator = (id: string, travel: Connector['travel']): Connector => ({
  id,
  kind: 'escalator',
  lower: { x: BANK.x, z: BANK.z, level: 'mezzanine' },
  upper: { x: BANK.x, z: BANK.z, level: 'street' },
  width: 1.2,
  travel,
  sources: ['authored'],
})

const ADDED: Connector[] = [
  bankEscalator('ES-DEMO-B1', 'up'),
  bankEscalator('ES-DEMO-B2', 'down'),
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
  return {
    ...interior,
    connectors: [...connectors, ...ADDED].sort((a, b) => a.id.localeCompare(b.id)),
    entrances: [...interior.entrances, BANK],
  }
}
