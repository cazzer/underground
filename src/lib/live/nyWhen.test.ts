import { describe, expect, it } from 'vitest'
import { nyTime, nyWhen } from './nyWhen'

// 2026-11-23 15:22:05 New York.
const NOW = 1795465325
const HOUR = 3600

describe('nyTime', () => {
  it('drops :00 and keeps AM/PM', () => {
    expect(nyTime(NOW)).toBe('3:22 PM')
    expect(nyTime(NOW + 38 * 60)).toBe('4 PM')
  })
})

describe('nyWhen', () => {
  it('reads by New York day: today, tomorrow, a weekday within six days, else the date', () => {
    expect(nyWhen(NOW + 5 * HOUR, NOW)).toBe('8:22 PM')
    expect(nyWhen(NOW + 10 * HOUR, NOW)).toBe('tomorrow 1:22 AM')
    expect(nyWhen(1795841100, NOW)).toBe('Fri 11:45 PM')
    expect(nyWhen(NOW + 30 * 86_400, NOW)).toBe('Dec 23')
  })
})
