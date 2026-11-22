import { ENE_SCHEMA_VERSION, type EneOutage, type EneSnapshot } from './schema'

/** Equipment codes look like "EL358", "ES112", "EL290X". Anything else is not trusted as a join key. */
const CODE_PATTERN = /^[A-Z]{2}[A-Z0-9]{1,10}$/
const REASON_MAX_CHARS = 100
/** The feed's times: New York local, "11/22/2026 12:00:00 AM". */
const TIME_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2}) (AM|PM)$/

const NY_FIELDS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

const HOUR_MS = 3_600_000

/**
 * New York's UTC offset in ms at an instant (negative: behind UTC). It only changes on a UTC hour
 * boundary, so `cache` holds one answer per UTC hour (a feed repeats the same few hours many times).
 */
function nyOffsetMs(ms: number, cache: Map<number, number>): number {
  const hour = Math.floor(ms / HOUR_MS)
  const known = cache.get(hour)
  if (known !== undefined) return known
  const fields: Record<string, number> = {}
  for (const part of NY_FIELDS.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(fields.year ?? NaN, (fields.month ?? NaN) - 1, fields.day, fields.hour, fields.minute, fields.second)
  const offset = asUtc - Math.floor(ms / 1000) * 1000
  cache.set(hour, offset)
  return offset
}

/**
 * A feed time to epoch seconds, or null if it is not exactly that format or not a real date.
 * A wall-clock time inside the spring-forward gap does not exist; it is read with the daylight
 * offset, so it lands an hour earlier on the wall clock (02:30 reads as 01:30 EST). An ambiguous
 * fall-back time takes its first (daylight) occurrence. `offsets` memoises New York's offset per
 * UTC hour across calls.
 */
export function parseNyTime(text: string, offsets: Map<number, number> = new Map()): number | null {
  const m = TIME_PATTERN.exec(text)
  if (!m) return null
  const [month, day, year, hour12, minute, second] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number]
  if (hour12 < 1 || hour12 > 12) return null
  const hour = (hour12 % 12) + (m[7] === 'PM' ? 12 : 0)
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const check = new Date(guess)
  const roundTrips =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute &&
    check.getUTCSeconds() === second
  if (!roundTrips) return null
  const guessOffset = nyOffsetMs(guess, offsets)
  let t = guess - guessOffset
  const offset = nyOffsetMs(t, offsets)
  if (offset !== guessOffset) t = guess - offset
  return Math.floor(t / 1000)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Free text from upstream: whitespace collapsed (again after the strip), control and format characters (bidi overrides) removed, 100 code points. */
function parseReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim()
  // By code point, so the cap never splits a surrogate pair.
  const reason = Array.from(clean).slice(0, REASON_MAX_CHARS).join('').trim()
  return reason === '' ? null : reason
}

export interface EneResult {
  snapshot: EneSnapshot
  /** Rows for outages not yet started at generatedAt (skipped; logged only). */
  upcoming: number
  /** In-effect rows repeating a code (the earliest since is kept; logged only). */
  duplicates: number
}

/**
 * Trims the MTA outage list to the outages in effect at `generatedAt`, one per equipment code.
 * `isupcomingoutage` is unreliable both ways (started outages flagged Y, overdue ones flagged N), so
 * it is ignored: a row is upcoming, and skipped, exactly when it starts after `generatedAt`. A past
 * return time never removes one. Malformed rows are dropped and counted, never silent. Throws TypeError if the list is not an array.
 */
export function transformEne(json: unknown, generatedAt: number): EneResult {
  if (!Array.isArray(json)) throw new TypeError(`ene: expected an array, got ${json === null ? 'null' : typeof json}`)
  const byCode = new Map<string, EneOutage>()
  let dropped = 0
  let upcoming = 0
  let duplicates = 0
  const offsets = new Map<number, number>()
  for (const row of json as unknown[]) {
    const since = isRecord(row) && typeof row.outagedate === 'string' ? parseNyTime(row.outagedate, offsets) : null
    if (!isRecord(row) || typeof row.equipment !== 'string' || !CODE_PATTERN.test(row.equipment) || since === null) {
      dropped++
      continue
    }
    if (since > generatedAt) {
      upcoming++
      continue
    }
    const outage: EneOutage = {
      code: row.equipment,
      reason: parseReason(row.reason),
      since,
      returnAt: typeof row.estimatedreturntoservice === 'string' ? parseNyTime(row.estimatedreturntoservice, offsets) : null,
    }
    const earlier = byCode.get(outage.code)
    if (earlier) duplicates++
    if (!earlier || outage.since < earlier.since) byCode.set(outage.code, outage)
  }
  const outages = [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  return { snapshot: { version: ENE_SCHEMA_VERSION, generatedAt, dropped, outages }, upcoming, duplicates }
}
