import { ENE_SCHEMA_VERSION, type EneOutage, type EneSnapshot } from './realtime'
import { SchemaMismatchError } from './realtimeFetch'
import { fetchWorkerJson, type WorkerFetchResult } from './workerFetch'

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseOutage(raw: unknown, index: number): EneOutage {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const { code, reason, since, returnAt } = r
  if (typeof code !== 'string' || code === '') throw new Error(`outage ${index} has no code`)
  if (!isNumber(since)) throw new Error(`outage ${index} (${code}) has no since`)
  if (returnAt !== null && !isNumber(returnAt)) throw new Error(`outage ${index} (${code}) has a bad returnAt`)
  if (reason !== null && typeof reason !== 'string') throw new Error(`outage ${index} (${code}) has a bad reason`)
  return { code, reason, since, returnAt }
}

/** Checks a /ene body: the version, `generatedAt`, and every outage row (which row, in the message, when one is bad). */
export function parseEneSnapshot(raw: unknown): EneSnapshot {
  if (typeof raw !== 'object' || raw === null) throw new Error('outage response is not an object')
  const r = raw as Record<string, unknown>
  if (r.version !== ENE_SCHEMA_VERSION) {
    throw new SchemaMismatchError(`outage schema v${String(r.version)}, client expects v${ENE_SCHEMA_VERSION}; reload`)
  }
  if (!isNumber(r.generatedAt)) throw new Error('outage response has no generatedAt')
  if (!isNumber(r.dropped)) throw new Error('outage response has no dropped count')
  if (!Array.isArray(r.outages)) throw new Error('outage response has no outages array')
  return { version: ENE_SCHEMA_VERSION, generatedAt: r.generatedAt, dropped: r.dropped, outages: r.outages.map(parseOutage) }
}

export type EneFetchResult = WorkerFetchResult<EneSnapshot>

/** One /ene poll (`fetchWorkerJson`: failures come back as `ok: false`, a 503 warming is flagged). */
export const fetchEne = (url: string, signal: AbortSignal): Promise<EneFetchResult> => fetchWorkerJson(url, signal, parseEneSnapshot)
