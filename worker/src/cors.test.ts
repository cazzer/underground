import { describe, expect, it } from 'vitest'
import { PREFLIGHT_HEADERS, corsHeaders } from './cors'

describe('corsHeaders', () => {
  it.each([
    'https://cazzer.github.io',
    'http://localhost:5173',
    'http://localhost',
    'http://127.0.0.1:8787',
  ])('echoes allowed origin %s', (origin) => {
    expect(corsHeaders(origin)['Access-Control-Allow-Origin']).toBe(origin)
  })

  it.each([
    'https://cazzer.github.io.evil.com',
    'http://cazzer.github.io',
    'http://localhost.evil.com',
    'http://localhost:99999999',
    'https://localhost:5173',
    'https://evil.com',
    'null',
    null,
  ])('omits ACAO for %s', (origin) => {
    expect(corsHeaders(origin)).not.toHaveProperty('Access-Control-Allow-Origin')
  })

  it('always varies on Origin', () => {
    expect(corsHeaders('https://cazzer.github.io').Vary).toBe('Origin')
    expect(corsHeaders('https://evil.com').Vary).toBe('Origin')
    expect(corsHeaders(null).Vary).toBe('Origin')
  })

  it('exports preflight headers', () => {
    expect(PREFLIGHT_HEADERS['Access-Control-Allow-Methods']).toBe('GET, OPTIONS')
    expect(PREFLIGHT_HEADERS['Access-Control-Max-Age']).toBe('86400')
  })
})
