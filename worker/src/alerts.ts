import {
  ALERTS_SCHEMA_VERSION,
  ALERT_HEADER_MAX_CHARS,
  ALERT_MAX_ENTITIES,
  ALERT_MAX_PERIODS,
  ALERT_WINDOW_S,
  type AlertEntity,
  type AlertPeriod,
  type AlertsSnapshot,
  type ServiceAlert,
} from './schema'

const ID_PATTERN = /^[\w:.-]{1,100}$/
const ROUTE_PATTERN = /^[A-Z0-9]{1,4}$/
const STOP_PATTERN = /^[A-Z0-9]{1,6}$/
const TYPE_MAX_CHARS = 80
const PERIOD_TEXT_MAX_CHARS = 200

type Rec = Record<string, unknown>

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The `en` translation of a TranslatedString, byte for byte; the `en-html` one is never read. */
function englishText(value: unknown): string | null {
  const list = isRecord(value) ? value.translation : null
  if (!Array.isArray(list)) return null
  for (const t of list) {
    if (isRecord(t) && t.language === 'en' && typeof t.text === 'string') return t.text
  }
  return null
}

function parseEntity(raw: unknown): AlertEntity | null {
  if (!isRecord(raw)) return null
  const { route_id: route, stop_id: stop, direction_id: direction } = raw
  if (typeof route !== 'string' || !ROUTE_PATTERN.test(route)) return null
  if (stop !== undefined && (typeof stop !== 'string' || !STOP_PATTERN.test(stop))) return null
  if (direction !== undefined && direction !== 0 && direction !== 1) return null
  return { route, stop: stop ?? null, direction: direction === undefined ? null : direction === 0 ? 'N' : 'S' }
}

function parsePeriods(raw: unknown): AlertPeriod[] | null {
  if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) return [[0, null]]
  if (!Array.isArray(raw)) return null
  const periods: AlertPeriod[] = []
  for (const p of raw) {
    if (!isRecord(p)) return null
    if ((p.start !== undefined && !isTime(p.start)) || (p.end !== undefined && !isTime(p.end))) return null
    periods.push([p.start ?? 0, p.end ?? null])
  }
  return periods
}

export interface AlertsTransform {
  snapshot: AlertsSnapshot
  /** Valid alerts with no period in the window. */
  outsideWindow: number
  /** Informed entities skipped as malformed (their alert stays when another entity is good). */
  entitiesDropped: number
  /** Entities beyond ALERT_MAX_ENTITIES, and periods beyond ALERT_MAX_PERIODS, left out. */
  entitiesCut: number
  periodsCut: number
}

/**
 * The feed's alerts that are in effect, or start within ALERT_WINDOW_S, as the trimmed contract. `display_before_active`
 * is ignored: the window is the active periods alone. The header is the feed's `en` text unchanged (MTA terms: never
 * edited), so an alert whose header is too long, or missing, is dropped, not truncated. `description_text` and the
 * `en-html` strings are never read. A non-array `entity` throws (an upstream format change must fail loudly).
 */
export function transformAlerts(json: unknown, generatedAt: number): AlertsTransform {
  const feed = isRecord(json) ? json : null
  if (!feed || !Array.isArray(feed.entity)) throw new TypeError('alerts feed has no entity array')
  const windowEnd = generatedAt + ALERT_WINDOW_S
  const alerts: ServiceAlert[] = []
  let dropped = 0
  let outsideWindow = 0
  let entitiesDropped = 0
  let entitiesCut = 0
  let periodsCut = 0
  for (const item of feed.entity) {
    const alert = isRecord(item) && isRecord(item.alert) ? item.alert : null
    const id = isRecord(item) ? item.id : undefined
    const header = alert ? englishText(alert.header_text) : null
    const periods = alert ? parsePeriods(alert.active_period) : null
    if (!alert || typeof id !== 'string' || !ID_PATTERN.test(id) || header === null || header === '' || header.length > ALERT_HEADER_MAX_CHARS || !periods || !Array.isArray(alert.informed_entity)) {
      dropped++
      continue
    }
    const seen = new Set<string>()
    const entities: AlertEntity[] = []
    for (const raw of alert.informed_entity) {
      const entity = parseEntity(raw)
      if (!entity) {
        entitiesDropped++
        continue
      }
      const key = `${entity.route}|${entity.stop ?? ''}|${entity.direction ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      if (entities.length < ALERT_MAX_ENTITIES) entities.push(entity)
      else entitiesCut++
    }
    if (entities.length === 0) {
      dropped++
      continue
    }
    const inWindow = periods.filter(([start, end]) => start < windowEnd && (end === null || end > generatedAt)).sort((a, b) => a[0] - b[0])
    if (inWindow.length === 0) {
      outsideWindow++
      continue
    }
    periodsCut += Math.max(0, inWindow.length - ALERT_MAX_PERIODS)
    const meta = isRecord(alert['transit_realtime.mercury_alert']) ? alert['transit_realtime.mercury_alert'] : {}
    const type = typeof meta.alert_type === 'string' && meta.alert_type.length <= TYPE_MAX_CHARS ? meta.alert_type : null
    const period = englishText(meta.human_readable_active_period)
    alerts.push({
      id,
      type,
      header,
      period: period !== null && period.length <= PERIOD_TEXT_MAX_CHARS ? period : null,
      periods: inWindow.slice(0, ALERT_MAX_PERIODS),
      entities,
    })
  }
  alerts.sort((a, b) => a.periods[0]![0] - b.periods[0]![0] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { snapshot: { version: ALERTS_SCHEMA_VERSION, generatedAt, dropped, alerts }, outsideWindow, entitiesDropped, entitiesCut, periodsCut }
}
