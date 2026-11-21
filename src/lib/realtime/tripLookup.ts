import { deltaDecode, parseShapeId, tripKey } from '../../data/codec'
import type {
  CalendarException,
  ServiceCalendar,
  ServiceId,
  ShapeId,
  ShapesFile,
  TripIndexFile,
  TripPattern,
} from '../../data/schema'

export interface TripLookup {
  patterns: Readonly<Record<ShapeId, TripPattern>>
  calendar: Readonly<Record<ServiceId, ServiceCalendar>>
  exceptions: readonly CalendarException[]
  /** service → tripKey(origin, route, dir) → shapes (usually one). Registered under the shape token and pattern.routeId. */
  keys: ReadonlyMap<ServiceId, ReadonlyMap<string, readonly ShapeId[]>>
  /** `${routeId}|${direction}` → primary shape */
  primary: ReadonlyMap<string, ShapeId>
}

export function primaryKey(route: string, direction: string): string {
  return `${route}|${direction}`
}

/** Decodes trip-index origins into per-service key maps. Throws when the two files are from different builds. */
export function buildTripLookup(index: TripIndexFile, shapes: ShapesFile): TripLookup {
  if (index.feedVersion !== shapes.feedVersion) {
    throw new Error(`feedVersion mismatch: trip-index ${index.feedVersion} vs shapes ${shapes.feedVersion}`)
  }
  const keys = new Map<ServiceId, Map<string, ShapeId[]>>()
  for (const [service, byShape] of Object.entries(index.origins)) {
    const map = new Map<string, ShapeId[]>()
    for (const shapeId of Object.keys(byShape).sort()) {
      const pattern = index.patterns[shapeId]
      const parsed = parseShapeId(shapeId)
      if (!pattern || !parsed) throw new Error(`trip-index origins reference unknown shape ${shapeId}`)
      const routes = new Set([parsed.token, pattern.routeId])
      for (const origin of deltaDecode(byShape[shapeId]!)) {
        for (const route of routes) {
          const key = tripKey(origin, route, pattern.direction)
          const list = map.get(key)
          if (!list) map.set(key, [shapeId])
          else if (!list.includes(shapeId)) list.push(shapeId)
        }
      }
    }
    keys.set(service, map)
  }
  const primary = new Map<string, ShapeId>()
  for (const s of shapes.shapes) if (s.primary) primary.set(primaryKey(s.routeId, s.direction), s.id)
  return {
    patterns: index.patterns,
    calendar: index.calendar,
    exceptions: index.calendarExceptions,
    keys,
    primary,
  }
}
