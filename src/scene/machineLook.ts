/**
 * TEMPORARY until the escalator and elevator look is picked (9wc.8 review card).
 * `?machines=a|b|c` (default a): A rails and cab; B a plain band and box, escalators in the stroke
 * color; C plan symbols (centerline arrow, crossed square). Once decided, remove together:
 * - this file: pass the chosen `MachineStyle` as a constant in interiorModel.ts and, if B wins,
 *   drop `interiorEscalator` (escalators use `interiorStroke`) or keep it and drop `escalatorAccent`
 * - interiorConnectors.ts: the unchosen `MachineStyle` branches (and the type itself)
 * - src/data/machineDemo.ts and its `?machinesDemo` hook in src/data/useStationInterior.ts
 * - AGENTS.md: the `?machines=` / `?machinesDemo` TEMPORARY note and machineLook.ts and
 *   machineDemo.ts in the directory map
 */
import type { MachineStyle } from '../lib/interiorGeometry'

export interface MachineLook {
  style: MachineStyle
  /** Escalators in their own token (`interiorEscalator`) rather than the stroke color. */
  escalatorAccent: boolean
}

const LOOKS = {
  a: { style: { escalator: 'rails', elevator: 'cab' }, escalatorAccent: true },
  b: { style: { escalator: 'band', elevator: 'box' }, escalatorAccent: false },
  c: { style: { escalator: 'arrow', elevator: 'cross' }, escalatorAccent: true },
} as const satisfies Record<string, MachineLook>

export function resolveMachineLook(search: string): MachineLook {
  const name = new URLSearchParams(search).get('machines')
  return name === 'b' || name === 'c' ? LOOKS[name] : LOOKS.a
}

export const machineLook: MachineLook = resolveMachineLook(window.location.search)
