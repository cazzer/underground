/** The tests' synthetic top-down view for the view-station choice (a canvas 1000 x 800, 1 px per meter, the target at the middle). */
import type { ScreenRect } from './interiorCamera'
import type { ToScreen } from './pick'
import type { StationGroup } from './stationGroups'
import { MAX_VIEW_STATIONS, viewStationSpace, type ViewQuery, type ViewStationSpace } from './viewStations'

export const W = 1000
export const H = 800
export const FREE: ScreenRect = { left: 0, top: 100, right: 1000, bottom: 700 }

/** Top-down: the target is at the canvas middle, 1 px per meter. */
export function topDown(tx: number, tz: number): ToScreen {
  return (x, _y, z, out) => {
    out.x = x - tx + W / 2
    out.y = z - tz + H / 2
    return true
  }
}

/** A lone station group `id` at ground point (x, z). */
export function lone(id: string, x: number, z: number): StationGroup {
  return { id, pos: { x, z }, memberIds: [id] } as unknown as StationGroup
}

export function spaceOf(groups: StationGroup[]): ViewStationSpace {
  return viewStationSpace(groups, new Map())
}

/** A query at `distance` m looking at the origin, previous sized for `max` groups. */
export function queryAt(distance: number, over: Partial<ViewQuery> = {}, max = MAX_VIEW_STATIONS): ViewQuery {
  return { distance, tx: 0, tz: 0, free: FREE, toScreen: topDown(0, 0), focused: -1, previous: new Int32Array(max), previousCount: 0, ...over }
}
