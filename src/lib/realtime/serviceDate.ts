import type { CalendarException, ServiceCalendar, ServiceId } from '../../data/schema'

const NY_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function parts(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(4, 6)), Number(date.slice(6, 8))]
}

/** YYYYMMDD plus `days` (may be negative). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10).replaceAll('-', '')
}

/** Services running on a YYYYMMDD date: calendar range and weekday, then that date's exceptions. Sorted. */
export function servicesOn(
  date: string,
  calendar: Readonly<Record<ServiceId, ServiceCalendar>>,
  exceptions: readonly CalendarException[],
): ServiceId[] {
  const [y, m, d] = parts(date)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const active = new Set<ServiceId>()
  for (const [id, cal] of Object.entries(calendar)) {
    if (cal.start <= date && date <= cal.end && cal.days.includes(dow)) active.add(id)
  }
  for (const e of exceptions) {
    if (e.date !== date) continue
    if (e.exceptionType === 1) active.add(e.serviceId)
    else active.delete(e.serviceId)
  }
  return [...active].sort()
}

/** New York calendar date (YYYYMMDD) of an epoch-seconds instant. */
export function nyDate(epochSec: number): string {
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    NY_DATE.formatToParts(new Date(epochSec * 1000)).find((p) => p.type === type)!.value
  return part('year') + part('month') + part('day')
}

const NY_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

/** New York's offset from UTC, in seconds (negative), at an epoch-seconds instant. */
function nyOffsetS(epochSec: number): number {
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(NY_CLOCK.formatToParts(new Date(epochSec * 1000)).find((p) => p.type === type)!.value)
  const local = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) / 1000
  return local - epochSec
}

/**
 * Epoch seconds of a service day's time base (GTFS "noon minus 12 h"): New York noon on `date` (YYYYMMDD) minus
 * 12 h. Timetable seconds count from it. It is midnight New York time, except an hour off on the two DST days.
 */
export function serviceDayStart(date: string): number {
  const [y, m, d] = parts(date)
  // 17:00 UTC is after the 02:00 switch on any NY date, so its offset is the day's noon offset.
  const offset = nyOffsetS(Date.UTC(y, m - 1, d, 17) / 1000)
  return Date.UTC(y, m - 1, d, 12) / 1000 - offset - 12 * 3600
}
