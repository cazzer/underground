/** The pinned exceptions to the catalog join (data/stations/access-exceptions.json). The file is
 *  written by hand: a station the feed has but 39hk-dx4f doesn't list yet, or a catalog row for a
 *  station the feed doesn't have. `addAccess` throws when an entry stops being needed. */
import type { PartialAccess } from '../../src/data/schema.ts'

export interface MissingStation {
  /** `Borough` code; checked by `addAccess`. */
  borough: string
  /** `none`, `full` or `partial`; checked by `addAccess`. */
  ada: string
  adaPartial?: PartialAccess
  reason: string
}

export interface AccessExceptions {
  /** GTFS parent stop id to the access fields the catalog would have given. */
  missing: Record<string, MissingStation>
  /** GTFS stop id of a catalog row that has no GTFS station, to why that is fine. */
  orphans: Record<string, string>
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Checks the outer shape of the parsed file; the values are checked by `addAccess`. */
export function parseAccessExceptions(value: unknown): AccessExceptions {
  const keys = isRecord(value) ? Object.keys(value).sort().join(',') : ''
  if (!isRecord(value) || keys !== 'missing,orphans' || !isRecord(value.missing) || !isRecord(value.orphans)) {
    throw new Error('data/stations/access-exceptions.json must be { "missing": {...}, "orphans": {...} }')
  }
  for (const [id, e] of Object.entries(value.missing)) {
    if (!isRecord(e) || typeof e.borough !== 'string' || typeof e.ada !== 'string' || typeof e.reason !== 'string' || e.reason.trim() === '') {
      throw new Error(`access-exceptions.json "missing" ${id}: needs string borough and ada, and a non-empty reason`)
    }
    const p = e.adaPartial
    if (p !== undefined && (!isRecord(p) || typeof p.north !== 'boolean' || typeof p.south !== 'boolean' || typeof p.note !== 'string' || p.note.trim() === '')) {
      throw new Error(`access-exceptions.json "missing" ${id}: adaPartial needs boolean north and south and a non-empty note`)
    }
  }
  for (const [id, reason] of Object.entries(value.orphans)) {
    if (typeof reason !== 'string' || reason.trim() === '') throw new Error(`access-exceptions.json "orphans" ${id}: the reason must be a non-empty string`)
  }
  return value as unknown as AccessExceptions
}
