/**
 * Every committed dated timetable (public/data/timetable/dated/) builds a router Timetable against the committed
 * stations and transfers, without the stale-deploy warning. The window moves daily, so it reads whatever index.json
 * lists. Rerun `npm run data` when it fails. (Structure and caps: scripts/lib/datedTimetableOutputs.test.ts.)
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { route } from '../lib/route/raptor'
import { buildRouterTimetable } from '../lib/route/timetable'
import type { StationsFile, TransfersFile } from './schema'
import type { DatedTimetableIndex, TimetableFile } from './timetableSchema'

const read = <T>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, 'utf8')) as T
const stations = read<StationsFile>('stations.json')
const transfers = read<TransfersFile>('transfers.json').transfers
const index = read<DatedTimetableIndex>('timetable/dated/index.json')

describe('the committed dated timetables', () => {
  it.each(index.dates)('builds a router timetable for %s with no warning', (date) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const file = read<TimetableFile>(`timetable/dated/${date}.json`)
      const tt = buildRouterTimetable([{ label: `${date}:dated`, shiftS: 0, file }], stations, transfers)
      expect(tt.patterns.length).toBeGreaterThan(0)
      expect(warn).not.toHaveBeenCalled()
      // A morning trip across Manhattan: some trip exists on any day of the window.
      expect(route(tt, ['127'], ['635'], 8 * 3600).length).toBeGreaterThan(0)
    } finally {
      warn.mockRestore()
    }
  }, 60_000)
})
