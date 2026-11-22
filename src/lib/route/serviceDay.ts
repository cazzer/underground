/** Which services' timetable files a query at a given instant needs, and how far each is shifted. Pure. */
import type { CalendarException, ServiceCalendar, ServiceId } from '../../data/schema'
import { addDays, nyDate, serviceDayStart, servicesOn } from '../realtime/serviceDate'

/** Before this many seconds into the service day, yesterday's trips past 24:00 may still be running. */
export const YESTERDAY_UNTIL_S = 4 * 3600
/** From this many seconds into the day, trips that left after midnight (tomorrow's file) are in reach. A query
 *  before this can't use tomorrow's file, so a journey of 2 h or more leaving around 21:30 may miss post-midnight
 *  trains it could have caught (the trip panel should know). */
export const TOMORROW_FROM_S = 22 * 3600

/** One day's services. `shiftS` moves that day's timetable seconds onto the query day's time base. A `dated` frame
 *  reads the day's dated file (which replaces its service files), so `services` is then only the calendar's answer. */
export interface ServiceFrame {
  date: string
  services: readonly ServiceId[]
  shiftS: number
  dated: boolean
}

export interface ServiceWindow {
  /** The query's New York date. */
  date: string
  /** Epoch seconds of that day's time base: router seconds + `startS` = epoch seconds. */
  startS: number
  /** Yesterday (early), today, tomorrow (late), in that order; days with no service are left out. */
  frames: readonly ServiceFrame[]
}

/** The frames a query at epoch-seconds `atS` reads; `datedDates` are the dates that have a dated file. No frames means
 *  neither the calendar nor the dated files have service that day. */
export function serviceWindow(
  atS: number,
  calendar: Readonly<Record<ServiceId, ServiceCalendar>>,
  exceptions: readonly CalendarException[],
  datedDates: ReadonlySet<string> = new Set(),
): ServiceWindow {
  const date = nyDate(atS)
  const startS = serviceDayStart(date)
  const q = atS - startS
  const frameOf = (day: string): ServiceFrame => ({
    date: day,
    services: servicesOn(day, calendar, exceptions),
    shiftS: serviceDayStart(day) - startS,
    dated: datedDates.has(day),
  })
  const frames = [
    ...(q < YESTERDAY_UNTIL_S ? [frameOf(addDays(date, -1))] : []),
    frameOf(date),
    ...(q >= TOMORROW_FROM_S ? [frameOf(addDays(date, 1))] : []),
  ]
  return { date, startS, frames: frames.filter((f) => f.dated || f.services.length > 0) }
}

/** Equal for two windows that would build the same timetable. */
export function windowKey(w: ServiceWindow): string {
  return `${w.date}|${w.frames.map((f) => `${f.date}:${f.dated ? 'dated' : f.services.join('+')}`).join(',')}`
}
