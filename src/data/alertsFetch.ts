import { ALERTS_SCHEMA_VERSION, type AlertEntity, type AlertPeriod, type AlertsSnapshot, type ServiceAlert } from './realtime'
import { SchemaMismatchError } from './realtimeFetch'
import { fetchWorkerJson, type WorkerFetchResult } from './workerFetch'

type Rec = Record<string, unknown>

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseEntity(raw: unknown, where: string): AlertEntity {
  if (!isRecord(raw)) throw new Error(`${where} is not an object`)
  const { route, stop, direction } = raw
  if (typeof route !== 'string' || route === '') throw new Error(`${where} has no route`)
  if (stop !== null && typeof stop !== 'string') throw new Error(`${where} has a bad stop`)
  if (direction !== null && direction !== 'N' && direction !== 'S') throw new Error(`${where} has a bad direction`)
  return { route, stop, direction }
}

function parsePeriod(raw: unknown, where: string): AlertPeriod {
  if (!Array.isArray(raw) || raw.length !== 2 || !isNumber(raw[0]) || (raw[1] !== null && !isNumber(raw[1]))) {
    throw new Error(`${where} is not [start, end]`)
  }
  return [raw[0], raw[1]]
}

function parseAlert(raw: unknown, index: number): ServiceAlert {
  if (!isRecord(raw)) throw new Error(`alert ${index} is not an object`)
  const { id, type, header, periods, entities } = raw
  if (typeof id !== 'string' || id === '') throw new Error(`alert ${index} has no id`)
  const where = `alert ${index} (${id})`
  if (type !== null && typeof type !== 'string') throw new Error(`${where} has a bad type`)
  if (typeof header !== 'string') throw new Error(`${where} has no header`)
  if (!Array.isArray(periods)) throw new Error(`${where} has no periods`)
  if (!Array.isArray(entities)) throw new Error(`${where} has no entities`)
  return {
    id,
    type,
    header,
    periods: periods.map((p, i) => parsePeriod(p, `${where} period ${i}`)),
    entities: entities.map((e, i) => parseEntity(e, `${where} entity ${i}`)),
  }
}

/** Checks a /alerts body: the version, `generatedAt`, and every alert (which one, in the message, when one is bad). */
export function parseAlertsSnapshot(raw: unknown): AlertsSnapshot {
  if (!isRecord(raw)) throw new Error('alerts response is not an object')
  if (raw.version !== ALERTS_SCHEMA_VERSION) {
    throw new SchemaMismatchError(`alerts schema v${String(raw.version)}, client expects v${ALERTS_SCHEMA_VERSION}; reload`)
  }
  if (!isNumber(raw.generatedAt)) throw new Error('alerts response has no generatedAt')
  if (!isNumber(raw.dropped)) throw new Error('alerts response has no dropped count')
  if (!Array.isArray(raw.alerts)) throw new Error('alerts response has no alerts array')
  return { version: ALERTS_SCHEMA_VERSION, generatedAt: raw.generatedAt, dropped: raw.dropped, alerts: raw.alerts.map(parseAlert) }
}

export type AlertsFetchResult = WorkerFetchResult<AlertsSnapshot>

/** One /alerts poll (`fetchWorkerJson`: failures come back as `ok: false`, a 503 warming is flagged). */
export const fetchAlerts = (url: string, signal: AbortSignal): Promise<AlertsFetchResult> => fetchWorkerJson(url, signal, parseAlertsSnapshot)
