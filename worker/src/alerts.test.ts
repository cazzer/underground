import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transformAlerts } from './alerts'
import { ALERTS_SCHEMA_VERSION, ALERT_HEADER_MAX_CHARS, ALERT_MAX_ENTITIES, ALERT_MAX_PERIODS } from './schema'

/** The feed header's timestamp, 2026-11-23 20:22:05 GMT (see fixtures/README.md). */
const GENERATED_AT = 1795465325

type Rec = Record<string, unknown>
const fixture = JSON.parse(readFileSync(new URL('../fixtures/alerts.json', import.meta.url), 'utf8')) as { entity: Rec[] }
const raw = (id: string): Rec => fixture.entity.find((e) => e.id === id) as Rec
const enHeader = (id: string): string => {
  const alert = raw(id).alert as { header_text: { translation: { text: string; language: string }[] } }
  return alert.header_text.translation.find((t) => t.language === 'en')!.text
}
const at = (t: number) => transformAlerts(fixture, t)
const byId = (t: number) => new Map(at(t).snapshot.alerts.map((a) => [a.id, a]))

/** A minimal valid entity, with `alert` fields overridden. */
const entity = (alert: Rec = {}, id = 'lmm:alert:1:26'): Rec => ({
  id,
  alert: {
    active_period: [{ start: 100, end: 200 }],
    informed_entity: [{ agency_id: 'MTASBWY', route_id: 'A' }],
    header_text: { translation: [{ text: 'Header', language: 'en' }] },
    ...alert,
  },
})
const run = (entities: Rec[], now = 150) => transformAlerts({ entity: entities }, now)

describe('transformAlerts on the recorded feed', () => {
  it('keeps the alerts in effect or starting within 24 h, soonest first, and drops the one a day further out', () => {
    const r = at(GENERATED_AT)
    expect(r.snapshot).toMatchObject({ version: ALERTS_SCHEMA_VERSION, generatedAt: GENERATED_AT, dropped: 0 })
    expect(r.snapshot.alerts.map((a) => a.id)).toEqual([
      'lmm:planned_work:33366',
      'lmm:planned_work:31498',
      'lmm:planned_work:35124',
      'lmm:planned_work:31871',
      'lmm:alert:277657:26',
      'lmm:planned_work:35952',
      'lmm:planned_work:35962',
      'lmm:planned_work:35972',
      'lmm:planned_work:35976',
    ])
    expect(r.outsideWindow).toBe(3)
  })

  it('passes every header through byte for byte, the line break of 31498 included', () => {
    for (const a of at(GENERATED_AT).snapshot.alerts) expect(a.header).toBe(enHeader(a.id))
    expect(byId(GENERATED_AT).get('lmm:planned_work:31498')!.header).toContain('\nAll trains at Woodside-61 St')
  })

  it('maps direction_id 0 to N, 1 to S and absent to null, and keeps the route-only and stop entities apart', () => {
    const alerts = byId(GENERATED_AT)
    expect(alerts.get('lmm:planned_work:35124')!.entities).toEqual([
      { route: '1', stop: '112', direction: 'S' },
      { route: '1', stop: '116', direction: 'S' },
      { route: '1', stop: '117', direction: 'S' },
    ])
    expect(alerts.get('lmm:planned_work:35972')!.entities[0]).toEqual({ route: 'R', stop: 'R36', direction: 'N' })
    expect(alerts.get('lmm:planned_work:35962')!.entities[0]).toEqual({ route: 'N', stop: 'R09', direction: null })
    expect(alerts.get('lmm:alert:277657:26')!.entities).toEqual([
      { route: 'B', stop: null, direction: null },
      { route: 'D', stop: null, direction: null },
    ])
  })

  it('keeps the type verbatim and ships no human-readable period', () => {
    const a = byId(GENERATED_AT).get('lmm:planned_work:35124')!
    expect(a.type).toBe('Planned - Stops Skipped')
    expect(Object.keys(a).sort()).toEqual(['entities', 'header', 'id', 'periods', 'type'])
  })

  it('keeps only the periods overlapping the window, unclipped, with a missing start as 0 and a missing end as null', () => {
    const alerts = byId(GENERATED_AT)
    expect(alerts.get('lmm:planned_work:31871')!.periods).toEqual([
      [1795464000, 1795489200],
      [1795518900, 1795532400],
    ])
    // The end is far beyond the window and is not cut to it.
    expect(alerts.get('lmm:planned_work:35124')!.periods).toEqual([[1793005200, 1795841100]])
    expect(alerts.get('lmm:alert:277657:26')!.periods).toEqual([[GENERATED_AT, null]])
  })

  it('brings the parade alert in once it is within 24 h and drops the ones that have ended', () => {
    const later = byId(1795680000)
    expect(later.get('lmm:planned_work:36685')!.periods).toEqual([[1795683600, 1795697100]])
    expect(later.has('lmm:planned_work:35976')).toBe(false)
    expect(later.has('lmm:planned_work:31871')).toBe(false)
  })

  it('has the entities as the feed lists them: 22 for the 4/6 skip', () => {
    expect(byId(GENERATED_AT).get('lmm:planned_work:35976')!.entities).toHaveLength(22)
  })
})

describe('transformAlerts windows and limits', () => {
  it('drops an alert that ended before now and one that starts at or after the window end', () => {
    expect(run([entity({ active_period: [{ start: 10, end: 150 }] })]).snapshot.alerts).toEqual([])
    expect(run([entity({ active_period: [{ start: 150 + 86_400 }] })]).snapshot.alerts).toEqual([])
    expect(run([entity({ active_period: [{ start: 150 + 86_399 }] })]).snapshot.alerts).toHaveLength(1)
  })

  it('ignores display_before_active', () => {
    const early = entity({ active_period: [{ start: 150 + 90_000, end: 150 + 100_000 }], 'transit_realtime.mercury_alert': { display_before_active: 7_200_000 } })
    const r = run([early])
    expect(r.snapshot.alerts).toEqual([])
    expect(r.outsideWindow).toBe(1)
  })

  it('reads no active_period as always on', () => {
    expect(run([entity({ active_period: undefined })]).snapshot.alerts[0]!.periods).toEqual([[0, null]])
  })

  it('keeps the first four periods in order and counts the rest', () => {
    const periods = Array.from({ length: 6 }, (_, i) => ({ start: 100 + (5 - i) * 10, end: 10_000 }))
    const r = run([entity({ active_period: periods })])
    expect(r.snapshot.alerts[0]!.periods.map((p) => p[0])).toEqual([100, 110, 120, 130])
    expect(r.periodsCut).toBe(6 - ALERT_MAX_PERIODS)
  })

  it('dedupes entities and caps them, counting the cut ones', () => {
    const many = Array.from({ length: ALERT_MAX_ENTITIES + 5 }, (_, i) => ({ route_id: 'A', stop_id: `A${i}` }))
    const r = run([entity({ informed_entity: [{ route_id: 'A' }, { route_id: 'A' }, ...many] })])
    expect(r.snapshot.alerts[0]!.entities).toHaveLength(ALERT_MAX_ENTITIES)
    expect(r.entitiesCut).toBe(6)
  })

  it('reads only the en translation, never en-html, and never edits it', () => {
    const header_text = {
      translation: [
        { text: '<p>Html</p>', language: 'en-html' },
        { text: '  Downtown [1] skips 125 St \n', language: 'en' },
      ],
    }
    expect(run([entity({ header_text })]).snapshot.alerts[0]!.header).toBe('  Downtown [1] skips 125 St \n')
    expect(run([entity({ header_text: { translation: [{ text: '<p>x</p>', language: 'en-html' }] } })]).snapshot.dropped).toBe(1)
  })
})

describe('transformAlerts bad input', () => {
  it('drops an alert with a bad id, no header, a header over the cap, no valid entity or a bad period, and counts it', () => {
    const long = 'x'.repeat(ALERT_HEADER_MAX_CHARS + 1)
    const bad = [
      entity({}, 'has space'),
      entity({ header_text: { translation: [] } }),
      entity({ header_text: { translation: [{ text: long, language: 'en' }] } }),
      entity({ informed_entity: [{ route_id: 'a-b' }] }),
      entity({ informed_entity: [] }),
      entity({ active_period: [{ start: 'x' }] }),
      { id: 'lmm:alert:2:26' },
    ]
    const r = run([...bad, entity({}, 'lmm:alert:ok')])
    expect(r.snapshot.alerts.map((a) => a.id)).toEqual(['lmm:alert:ok'])
    expect(r.snapshot.dropped).toBe(bad.length)
  })

  it('drops a bad entity but keeps the alert when another is good, and counts it', () => {
    const r = run([entity({ informed_entity: [{ route_id: 'A', direction_id: 2 }, { route_id: 'C', stop_id: 'bad id' }, { route_id: 'E', direction_id: 0 }] })])
    expect(r.snapshot.alerts[0]!.entities).toEqual([{ route: 'E', stop: null, direction: 'N' }])
    expect(r.entitiesDropped).toBe(2)
  })

  it('nulls a type over its cap rather than cutting it', () => {
    const a = run([entity({ 'transit_realtime.mercury_alert': { alert_type: 't'.repeat(81) } })]).snapshot.alerts[0]!
    expect(a.type).toBeNull()
  })

  it('throws when the feed has no entity array, so a format change fails loudly', () => {
    expect(() => transformAlerts({}, 1)).toThrow(TypeError)
    expect(() => transformAlerts({ entity: {} }, 1)).toThrow(TypeError)
    expect(() => transformAlerts(null, 1)).toThrow(TypeError)
  })
})
