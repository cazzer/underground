import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAlerts, parseAlertsSnapshot } from './alertsFetch'
import { alertsUrlFrom } from './realtime'
import { SchemaMismatchError } from './realtimeFetch'

const alert = () => ({
  id: 'lmm:planned_work:35124',
  type: 'Planned - Stops Skipped',
  header: 'Downtown [1] skips 125 St',
  period: null,
  periods: [[1_000, null]],
  entities: [{ route: '1', stop: '116', direction: 'S' }],
})
const valid = () => ({ version: 1, generatedAt: 1_000_000, dropped: 0, alerts: [alert()] })

describe('parseAlertsSnapshot', () => {
  it('accepts a valid body and keeps the header exactly', () => {
    const body = valid()
    body.alerts[0]!.header = '  line one\nline two '
    expect(parseAlertsSnapshot(body).alerts[0]!.header).toBe('  line one\nline two ')
  })

  it('throws SchemaMismatchError for another version', () => {
    expect(() => parseAlertsSnapshot({ ...valid(), version: 2 })).toThrow(SchemaMismatchError)
  })

  it('rejects a bad generatedAt or alerts list', () => {
    expect(() => parseAlertsSnapshot({ ...valid(), generatedAt: 'x' })).toThrow('generatedAt')
    expect(() => parseAlertsSnapshot({ ...valid(), alerts: {} })).toThrow('alerts array')
  })

  it('names the alert with a bad field', () => {
    expect(() => parseAlertsSnapshot({ ...valid(), alerts: [null] })).toThrow('alert 0')
    expect(() => parseAlertsSnapshot({ ...valid(), alerts: [{ ...alert(), header: 3 }] })).toThrow('alert 0 (lmm:planned_work:35124) has no header')
    expect(() => parseAlertsSnapshot({ ...valid(), alerts: [{ ...alert(), periods: [[1]] }] })).toThrow('period 0')
    expect(() => parseAlertsSnapshot({ ...valid(), alerts: [{ ...alert(), entities: [{ route: '1', stop: null, direction: 'E' }] }] })).toThrow('entity 0')
  })
})

describe('fetchAlerts', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('returns the snapshot, and flags a schema mismatch', async () => {
    const signal = new AbortController().signal
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(valid()))))
    expect(await fetchAlerts('http://w/alerts', signal)).toMatchObject({ ok: true, snapshot: { generatedAt: 1_000_000 } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...valid(), version: 9 }))))
    expect(await fetchAlerts('http://w/alerts', signal)).toMatchObject({ ok: false, schemaMismatch: true })
  })
})

describe('alertsUrlFrom', () => {
  it('is the /alerts sibling of the /rt URL, and never an MTA host', () => {
    expect(alertsUrlFrom('https://x.workers.dev/rt')).toBe('https://x.workers.dev/alerts')
    expect(alertsUrlFrom('http://localhost:8787/rt/')).toBe('http://localhost:8787/alerts')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(alertsUrlFrom('https://api.mta.info/rt')).toBeNull()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})
