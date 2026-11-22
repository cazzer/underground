import { ENE_SCHEMA_VERSION, type EneSnapshot } from './realtime'

/** An MTA equipment code: two letters (EL elevator, ES escalator) and its number. */
const CODE = /^[A-Z]{2}[A-Z0-9]{1,10}$/

/**
 * Dev only (`?ene=EL358,ES112`): the equipment codes to treat as out of service, to see outages without a Worker.
 * Null when the parameter is absent; entries that aren't equipment codes are dropped.
 */
export function devEneCodes(search: string): string[] | null {
  const raw = new URLSearchParams(search).get('ene')
  if (raw === null) return null
  return raw
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => CODE.test(c))
}

/** A snapshot with each code out since an hour ago, due back in three hours. */
export function devEneSnapshot(codes: readonly string[], nowS: number): EneSnapshot {
  return {
    version: ENE_SCHEMA_VERSION,
    generatedAt: nowS,
    dropped: 0,
    outages: [...codes].sort().map((code) => ({ code, reason: null, since: nowS - 3600, returnAt: nowS + 3 * 3600 })),
  }
}
