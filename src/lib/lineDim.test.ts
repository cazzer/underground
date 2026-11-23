/**
 * Drift guard between DIM_GLSL's dimLine and dimLineRgb: the GLSL body is pinned below and dimLineRgb follows it
 * statement for statement; dimLineRgb in turn must match mixHex, the mix the theme tests measure.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { DIM_GLSL } from '../scene/bandLineMaterial'
import { dimLineRgb, linearToSrgb, srgb01, srgbToLinear } from './lineDim'
import { mixHex, routeLineColor } from './routeColor'

const PINNED = `
	if ( lineDim <= 0.0 ) return c;
	vec3 s = mix( 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
	s = mix( s, lineDimColor, lineDim );
	return mix( pow( ( s + 0.055 ) / 1.055, vec3( 2.4 ) ), s / 12.92, vec3( lessThanEqual( s, vec3( 0.04045 ) ) ) );
`

const squash = (src: string) => src.replace(/\s+/g, ' ').trim()

async function loadTheme() {
  // theme.ts resolves the lines mode from window.location on import; tests run in node.
  vi.stubGlobal('window', { location: { search: '' } })
  const { theme } = await import('../theme')
  vi.unstubAllGlobals()
  return theme
}

describe('DIM_GLSL', () => {
  it("is the pinned dimLine, which dimLineRgb ports", () => {
    const body = /vec3 dimLine\( vec3 c \) \{([\s\S]*?)\n\}/.exec(DIM_GLSL)?.[1]
    expect(squash(body ?? '')).toBe(squash(PINNED))
  })
})

describe('dimLineRgb', () => {
  const routes: { color: string }[] = JSON.parse(readFileSync('public/data/routes.json', 'utf8')).routes

  it('is the identity at 0', () => {
    expect(dimLineRgb([0.2, 0.5, 0.9], [0.1, 0.1, 0.3], 0)).toEqual([0.2, 0.5, 0.9])
  })

  it('round-trips the transfer curves', () => {
    for (const v of [0, 0.001, 0.003, 0.04, 0.2, 0.7, 1]) expect(srgbToLinear(linearToSrgb(v))).toBeCloseTo(v, 9)
  })

  it.each([0.35, 0.7, 1])('mixes every drawn route color toward the background as mixHex does, at %s', async (t) => {
    const theme = await loadTheme()
    const BACKGROUND = theme.background
    const bg = srgb01(BACKGROUND)
    for (const r of routes) {
      const drawn = routeLineColor(`#${r.color}`, theme.routeLineMix, BACKGROUND)
      const linear = srgb01(drawn).map(srgbToLinear) as [number, number, number]
      const out = dimLineRgb(linear, bg, t).map(linearToSrgb)
      const want = srgb01(mixHex(drawn, BACKGROUND, t))
      out.forEach((v, i) => expect(Math.abs(v - want[i]!), `${drawn} at ${t}`).toBeLessThanOrEqual(1 / 255))
    }
  })
})
