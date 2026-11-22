import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLIENT_LIMIT, CLIENT_PERIOD_S } from './clientLimit'

interface Config {
  ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[]
  observability: {
    enabled: boolean
    redact_query_string: boolean
    logs: { enabled: boolean; invocation_logs: boolean }
    traces: { enabled: boolean }
  }
}

/** wrangler.jsonc with its full-line comments removed (it has no URLs in values). */
const config = JSON.parse(
  readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
) as Config

describe("wrangler.jsonc binds /geocode's per-client limit", () => {
  it('has one GEOCODE_CLIENT_LIMIT entry matching clientLimit.ts', () => {
    expect(config.ratelimits).toHaveLength(1)
    const [entry] = config.ratelimits
    expect(entry?.name).toBe('GEOCODE_CLIENT_LIMIT')
    expect(entry?.namespace_id).toMatch(/^[1-9]\d*$/)
    expect(entry?.simple).toEqual({ limit: CLIENT_LIMIT, period: CLIENT_PERIOD_S })
  })

  it('uses a period the binding accepts (10 or 60 s)', () => {
    expect([10, 60]).toContain(CLIENT_PERIOD_S)
  })
})

describe('wrangler.jsonc keeps /geocode queries out of platform logs', () => {
  it('turns invocation logs and traces off and redacts query strings', () => {
    expect(config.observability.logs.invocation_logs).toBe(false)
    expect(config.observability.traces.enabled).toBe(false)
    expect(config.observability.redact_query_string).toBe(true)
  })

  it('keeps our own console logs on', () => {
    expect(config.observability.enabled).toBe(true)
    expect(config.observability.logs.enabled).toBe(true)
  })
})
