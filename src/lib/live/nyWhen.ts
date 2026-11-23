import { addDays, nyDate } from '../realtime/serviceDate'

const NY_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })
const NY_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })
const NY_MONTH_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })

/** "6 AM" or "6:30 AM" in New York time (the AM/PM is needed: an outage or a service change can last a day). */
export function nyTime(epochS: number): string {
  const part = (type: Intl.DateTimeFormatPartTypes) => NY_TIME.formatToParts(epochS * 1000).find((p) => p.type === type)!.value
  const minute = part('minute')
  return `${part('hour')}${minute === '00' ? '' : `:${minute}`} ${part('dayPeriod')}`
}

/**
 * A moment as the words a panel shows, by New York days: "7:45 AM" later today, "tomorrow 5 AM", "Fri 11:45 PM"
 * within the next six days, else "Dec 31". A moment that has passed reads the same way (today's "7:45 AM" stays so).
 */
export function nyWhen(epochS: number, nowS: number): string {
  const day = nyDate(epochS)
  const today = nyDate(nowS)
  if (day === today) return nyTime(epochS)
  if (day === addDays(today, 1)) return `tomorrow ${nyTime(epochS)}`
  for (let n = 2; n <= 6; n++) {
    if (day === addDays(today, n)) return `${NY_WEEKDAY.format(epochS * 1000)} ${nyTime(epochS)}`
  }
  return NY_MONTH_DAY.format(epochS * 1000)
}
