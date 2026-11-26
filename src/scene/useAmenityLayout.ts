import { useEffect, useState } from 'react'
import type { AmenitiesFile } from '../data/amenitiesSchema'
import { groupMarks, type AmenityMark } from '../lib/amenityPlacement'
import type { Network } from '../lib/network'
import { addShape, newTrackGrid } from '../lib/trackGrid'
import { plateProbes } from './amenitySizes'

/** The most a slice of the layout may run, ms, before it yields to the next idle period. */
const SLICE_MS = 3

/** A slice runs by this long after it was asked for even on a page that never idles. */
const IDLE_TIMEOUT_MS = 500

const NO_MARKS: readonly AmenityMark[] = []

type Idle = (run: (deadline: { timeRemaining: () => number }) => void) => number
type CancelIdle = (id: number) => void

/** requestIdleCallback where there is one (not Safari), else a 16 ms timeout with a fixed slice. */
function idleApi(): { request: Idle; cancel: CancelIdle } {
  if (typeof window.requestIdleCallback === 'function') {
    return { request: (run) => window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS }), cancel: (id) => window.cancelIdleCallback(id) }
  }
  return { request: (run) => window.setTimeout(() => run({ timeRemaining: () => SLICE_MS }), 16), cancel: (id) => window.clearTimeout(id) }
}

/**
 * Every listed station group's amenity marks, laid out in idle time after the amenities file loads: first the track
 * grid, a few shapes per slice, then a few groups per slice (each slice stops after SLICE_MS or the idle period's end), so no frame does more
 * than a few ms of it. Empty until done, or with no file; a throw is logged and leaves no marks.
 */
export function useAmenityLayout(network: Network, amenities: AmenitiesFile | null): readonly AmenityMark[] {
  const [done, setDone] = useState<{ amenities: AmenitiesFile; network: Network; marks: readonly AmenityMark[] } | null>(null)

  useEffect(() => {
    if (!amenities) return
    const { request, cancel } = idleApi()
    const groups = network.stationGroups
    const out: AmenityMark[] = []
    const grid = newTrackGrid()
    const shapes = network.shapes
    let shape = 0
    let next = 0
    let handle = 0
    const slice = (deadline: { timeRemaining: () => number }) => {
      try {
        const start = performance.now()
        const room = () => Math.min(deadline.timeRemaining(), SLICE_MS - (performance.now() - start)) > 0
        // The grid a few shapes at a time, then the groups; at least one step a slice, so a busy page still finishes.
        do {
          if (shape < shapes.length) addShape(grid, shapes[shape++]!.points)
          else if (next < groups.length) out.push(...groupMarks(groups[next++]!, amenities, grid, network.stations, plateProbes))
        } while ((shape < shapes.length || next < groups.length) && room())
        if (shape < shapes.length || next < groups.length) handle = request(slice)
        else setDone({ amenities, network, marks: out })
      } catch (err) {
        console.error('Amenity marks: the layout failed', err)
      }
    }
    handle = request(slice)
    return () => cancel(handle)
  }, [network, amenities])

  return done && done.amenities === amenities && done.network === network ? done.marks : NO_MARKS
}
