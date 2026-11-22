import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Config {
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
