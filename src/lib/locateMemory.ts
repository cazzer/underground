/**
 * Where the user's location fixes put (or would put) the view (session memory only: no storage, URL, log or request).
 * The address search reads it to keep its bias away from the user's location: the view over a fix, and the station
 * nearest it, stay excluded however many other flights follow and even after the fix is cleared, until the camera
 * target has moved well away. The fix itself is never kept here, only the circle the camera framed. Two slots, each
 * held until its own rule forgets it, so a fix found in the search dialog never costs the header's flight its
 * exclusion, nor the reverse.
 */
import type { Ground } from './projection'

/** A candidate this close to the location flight's center is dropped (its framing radius may make this wider). */
export const LOCATE_GUARD_M = 2000

export interface LocateMemory {
  center: Ground
  radiusM: number
  /** The station nearest the fix: focusing it (the header's "Go to") says where the user is. */
  nearestId: string
}

interface Held {
  memory: LocateMemory
  /** The camera target has been within the guard since this was remembered: only then does leaving forget it. */
  armed: boolean
}

let flight: Held | null = null
let unviewed: Held | null = null

/** A location flight: the camera is on its way to the circle, so leaving it later is the user moving on. */
export function rememberLocate(memory: LocateMemory): void {
  flight = { memory, armed: true }
}

/**
 * A fix found with no flight (the search dialog's press): the circle the camera would frame, which the view may never
 * have visited. It holds until the camera target has once come within the guard and then left, so a far view never
 * forgets a fix the bias must still stay away from.
 */
export function rememberUnviewedFix(memory: LocateMemory): void {
  unviewed = { memory, armed: false }
}

export function forgetLocate(): void {
  flight = null
  unviewed = null
}

export const locateGuardM = (memory: LocateMemory): number => Math.max(LOCATE_GUARD_M, 2 * memory.radiusM)

const near = (memory: LocateMemory, at: Ground): boolean =>
  Math.hypot(at.x - memory.center.x, at.z - memory.center.z) <= locateGuardM(memory)

/** The slot to keep for a camera target: an armed one whose target has left is dropped, a near one arms. */
function kept(held: Held | null, view: Ground | null): Held | null {
  if (!held || !view) return held
  if (near(held.memory, view)) return { ...held, armed: true }
  return held.armed ? null : held
}

/**
 * The memories still in force for a camera target: once an armed one's target is farther from its center than the guard
 * (2 km at least), the user has moved on and it is forgotten for good. With no target (the scene isn't mounted) all hold.
 */
export function locateMemoryFor(view: Ground | null): readonly LocateMemory[] {
  flight = kept(flight, view)
  unviewed = kept(unviewed, view)
  return [flight, unviewed].flatMap((held) => (held ? [held.memory] : []))
}

/** Whether a bias candidate (a station, or the view) must be left out because of any of these memories. */
export function excludedByLocate(memories: readonly LocateMemory[], candidate: Ground, stationId: string | null): boolean {
  return memories.some((memory) => (stationId !== null && stationId === memory.nearestId) || near(memory, candidate))
}
