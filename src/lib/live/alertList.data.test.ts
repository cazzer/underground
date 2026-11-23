/** The header list on the recorded alerts feed (worker/fixtures/alerts.json, through the Worker's own transform) and the real route order. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transformAlerts } from '../../../worker/src/alerts'
import type { RoutesFile } from '../../data/schema'
import { changeDrawable } from '../changeDraw'
import { realStations } from '../realGroups.testdata'
import { alertChip, alertListView } from './alertList'

const FEED = JSON.parse(readFileSync('worker/fixtures/alerts.json', 'utf8')) as unknown
/** The feed's own timestamp, a Monday evening. */
const FEED_AT = 1795465325
const routes = (JSON.parse(readFileSync('public/data/routes.json', 'utf8')) as RoutesFile).routes
const routeOrder = new Map(routes.map((r, i) => [r.id, i]))
const snapshot = transformAlerts(FEED, FEED_AT).snapshot
const input = { configured: true, snapshot, failures: 0, schemaMismatch: false }
const stationById = new Map(realStations.map((s) => [s.id, s]))
const body = alertListView(input, routeOrder, FEED_AT, (a) => changeDrawable(a, stationById))
if (body.kind !== 'list') throw new Error('expected a list')
const short =(id: string) => id.replace('lmm:planned_work:', '')

describe('alertListView on the recorded feed', () => {
  it('lists the 1 train skip as in effect now', () => {
    const row = body.now.find((r) => short(r.id) === '35124')
    expect(row).toBeDefined()
    expect(row!.routeIds).toContain('1')
    expect(row!.when).toBe('Until Fri 11:45 PM')
  })

  it('lists a change starting tonight as later, with its New York time', () => {
    expect(body.later.find((r) => short(r.id) === '35972')?.when).toBe('Tonight 11:45 PM')
  })

  it('leaves out an alert that starts beyond the window', () => {
    const all = [...body.now, ...body.later].map((r) => short(r.id))
    expect(all).not.toContain('36685')
  })

  it('keeps every header equal to the feed text, and each alert once', () => {
    const rows = [...body.now, ...body.later]
    const byId = new Map(snapshot.alerts.map((a) => [a.id, a]))
    for (const r of rows) expect(r.header).toBe(byId.get(r.id)!.header)
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })

  it('counts the changes in effect in the chip (5 now, 4 later in the recording)', () => {
    expect([body.now.length, body.later.length]).toEqual([5, 4])
    expect(alertChip(body, false)).toEqual({ text: '5 service changes', mark: true })
  })
})

describe('drawable rows on the recorded feed', () => {
  const all = [...body.now, ...body.later]
  const drawable = (id: string) => all.find((r) => short(r.id) === id)?.drawable
  it('marks the skips and suspensions drawable, never a delay, a notice or an express-to-local change', () => {
    for (const id of ['35124', '31498', '35972', '35976', '35962', '35952']) expect(drawable(id), id).toBe(true)
    for (const id of ['33366', '31871']) expect(drawable(id), id).toBe(false)
    expect(all.find((r) => r.id.startsWith('lmm:alert:'))?.drawable).toBe(false)
  })
})
