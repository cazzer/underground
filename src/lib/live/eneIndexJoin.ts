import type { EquipmentIndexFile } from '../../data/equipmentSchema'
import type { StationInterior } from '../../data/stationSchema'
import { eneFresh, interiorMachines, type EneInput, type MachineOutage, type OutageJoin } from './eneJoin'

/** The equipment index (public/data/stations/equipment.json) as the focused station's panel sees it. */
export type EquipmentLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; index: EquipmentIndexFile }

export interface IndexMachine {
  id: string
  kind: 'elevator' | 'escalator'
  /** The inventory's description of what the machine connects, or null. */
  serving: string | null
}

/** What the index says about one station: not known yet, not available (idle, or the load failed), or its machines. */
export type StationEquipment = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; machines: readonly IndexMachine[] }

const UNAVAILABLE: StationEquipment = { status: 'unavailable' }

/** Every machine the index lists for the station's complex (none for a station it has no key for). */
export function stationEquipment(load: EquipmentLoad, stationId: string | null): StationEquipment {
  if (load.status === 'loading') return { status: 'loading' }
  if (load.status !== 'ready' || stationId === null) return UNAVAILABLE
  const { machines, stations } = load.index
  const codes = Object.hasOwn(stations, stationId) ? stations[stationId]! : []
  return { status: 'ready', machines: codes.map((id) => ({ id, kind: machines[id]!.kind, serving: machines[id]!.serving })) }
}

const byKindThenId = (a: MachineOutage, b: MachineOutage): number =>
  (a.kind === b.kind ? 0 : a.kind === 'elevator' ? -1 : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function kindsOf(machines: readonly { kind: 'elevator' | 'escalator' }[]): 'elevator' | 'escalator' | 'both' {
  const kinds = new Set(machines.map((m) => m.kind))
  return kinds.size === 2 ? 'both' : kinds.has('elevator') ? 'elevator' : 'escalator'
}

/**
 * The station panel's outages: the interior join (`base`, `joinStationOutages`) plus the machines only the equipment
 * index lists for the station's complex. Panel only: `outIds` (the drawing) and `closed` (step-free routing) stay the
 * interior's, since an index-only machine has no connector in any drawn or routed graph.
 *
 * Nothing about the extra machines is `known` until both the interior and the index have settled, so a source that
 * arrives late is never announced as a change (`outageAnnouncement` speaks only between two known views). Without the
 * index, or with no index-only machine at the station, `base` is returned as it is. With stale outage data the
 * panel says "status unavailable" for the union of kinds, and while the first poll is still connecting it says nothing.
 */
export function joinPanelOutages(
  base: OutageJoin,
  interior: StationInterior | null,
  interiorSettled: boolean,
  equipment: StationEquipment,
  ene: EneInput,
  nowS: number,
): OutageJoin {
  if (!interiorSettled || equipment.status === 'loading') return base.known ? { ...base, known: false } : base
  if (equipment.status === 'unavailable' || !ene.configured) return base
  const own = interior ? interiorMachines(interior) : []
  const ownIds = new Set(own.map((m) => m.id))
  const extra = equipment.machines.filter((m) => !ownIds.has(m.id))
  if (extra.length === 0) return base

  if (!eneFresh(ene.snapshot, nowS) || ene.schemaMismatch) {
    // No snapshot yet and fewer than two failed polls is still connecting, which shows nothing (as for an interior).
    if (ene.snapshot === null && ene.failures < 2 && !ene.schemaMismatch) return base
    return { ...base, panel: { kind: 'unknown', kinds: kindsOf([...own, ...extra]) } }
  }

  const listed = base.panel.kind === 'out' ? base.panel.outages : []
  const added = extra
    .filter((m) => ene.byCode?.has(m.id))
    .map((m): MachineOutage => ({ id: m.id, kind: m.kind, levels: m.serving, source: 'catalog', returnAt: ene.byCode!.get(m.id)!.returnAt }))
  const outages = [...listed, ...added].sort(byKindThenId)
  return { ...base, panel: outages.length > 0 ? { kind: 'out', outages } : { kind: 'none' }, known: true }
}
