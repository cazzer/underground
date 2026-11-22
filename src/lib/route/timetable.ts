/** Timetable files to the router's Timetable. Pure. */
import type { ServiceId, StationId, StationsFile, StopId, Transfer } from '../../data/schema'
import { decodePatternTimes } from '../../data/timetableCodec'
import type { TimetableFile } from '../../data/timetableSchema'
import { buildTimetable, makePatterns, type TripInput } from './patterns'
import { buildStopIndex, stationOfStopId } from './stops'
import type { ServiceWindow } from './serviceDay'
import type { Pattern, Timetable } from './types'

export interface TimetableSource {
  /** Unique per source in one build; prefixes the pattern keys and trip ids ("20261123:Weekday"). */
  label: string
  /** Added to every time, to put the file's service day on the query day's time base. */
  shiftS: number
  file: TimetableFile
}

/** One source per frame and service of `window`, labelled `<date>:<service>`, shifted by its frame. */
export function sourcesFor(window: ServiceWindow, filesByService: ReadonlyMap<ServiceId, TimetableFile>): TimetableSource[] {
  return window.frames.flatMap((frame) =>
    frame.services.map((id) => {
      const file = filesByService.get(id)
      if (!file) throw new Error(`no timetable file for service ${id}`)
      return { label: `${frame.date}:${id}`, shiftS: frame.shiftS, file }
    }),
  )
}

/**
 * One Timetable from decoded files. The stop index is stations.json's stops, so a station no trip serves still
 * routes (to nothing) instead of throwing. Stops and stations that stations.json lacks (a stale or mixed deploy)
 * are skipped and logged once. Patterns keep their file order in their key, so two lanes of one
 * stop sequence stay apart; a trip's id is `<label>/<pattern index>/<trip index>`.
 */
export function buildRouterTimetable(
  sources: readonly TimetableSource[],
  stations: StationsFile,
  transfers: readonly Transfer[],
): Timetable {
  const known = new Set<StopId>(stations.stations.flatMap((s) => s.stops))
  // From the stop set, so a station with no stops or an id that isn't its stops' prefix is skipped, not thrown on.
  const knownStations = new Set<StationId>([...known].map(stationOfStopId))
  const unknownStops = new Set<StopId>()
  const unknownStations = new Set<StationId>()
  let droppedPatterns = 0

  const changeS = new Map<StationId, number>()
  for (const { file } of sources) {
    for (const c of file.changes) {
      if (!knownStations.has(c.station)) unknownStations.add(c.station)
      else changeS.set(c.station, Math.min(changeS.get(c.station) ?? Infinity, c.minTransferSec))
    }
  }
  const linked = transfers.filter((t) => {
    const missing = [t.from, t.to].filter((id) => !knownStations.has(id))
    for (const id of missing) unknownStations.add(id)
    return missing.length === 0
  })
  const index = buildStopIndex({ stopIds: known, changeS, transfers: linked })

  const patterns: Pattern[] = []
  for (const { label, shiftS, file } of sources) {
    file.patterns.forEach((pattern, i) => {
      const keep: number[] = []
      pattern.stops.forEach((stop, k) => {
        if (known.has(stop)) keep.push(k)
        else unknownStops.add(stop)
      })
      if (keep.length < 2) {
        droppedPatterns += 1
        return
      }
      const key = `${label}/${i}`
      const trips: TripInput[] = decodePatternTimes(pattern).map((times, j) => ({
        id: `${key}/${j}`,
        routeId: pattern.routeId,
        arr: keep.map((k) => times.arrivals[k]! + shiftS),
        dep: keep.map((k) => times.departures[k]! + shiftS),
      }))
      patterns.push(...makePatterns(index, { key, stops: keep.map((k) => pattern.stops[k]!), trips }))
    })
  }

  if (unknownStops.size > 0 || unknownStations.size > 0 || droppedPatterns > 0) {
    console.warn(
      `timetable: stale or mixed deploy, skipped stops [${[...unknownStops].join(', ')}], ` +
        `stations [${[...unknownStations].join(', ')}], ${droppedPatterns} patterns with under two known stops`,
    )
  }
  return buildTimetable(index, patterns)
}
