import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { describe, expect, it } from 'vitest'
import { BAND_END, BAND_START, BAND_UNIFORMS, BandLineMaterial, patchBandShader } from './bandLineMaterial'

describe('patchBandShader', () => {
  const src = new LineMaterial().vertexShader

  it("patches the installed three's LineMaterial shader at both segment ends", () => {
    const out = patchBandShader(src)
    expect(out).toContain(`vec4 start = modelViewMatrix * vec4( bandShift( instanceStart, ${BAND_START} ), 1.0 );`)
    expect(out).toContain(`vec4 end = modelViewMatrix * vec4( bandShift( instanceEnd, ${BAND_END} ), 1.0 );`)
    // Declared after the uniforms and attributes it reads, before main.
    expect(out.indexOf('vec3 bandShift(')).toBeGreaterThan(out.indexOf('uniform vec2 resolution;'))
    expect(out.indexOf('vec3 bandShift(')).toBeLessThan(out.indexOf('void main()'))
    expect(out).not.toContain('vec4( instanceStart, 1.0 )')
    expect(out).not.toContain('vec4( instanceEnd, 1.0 )')
  })

  it('throws when an anchor is missing or repeated', () => {
    expect(() => patchBandShader('void main() {}')).toThrow(/Band shader/)
    expect(() => patchBandShader(src + src)).toThrow(/exactly one/)
  })
})

describe('BandLineMaterial', () => {
  it('shares the band uniforms by reference and keeps the line uniforms', () => {
    const a = new BandLineMaterial({ linewidth: 2 })
    const b = new BandLineMaterial()
    expect(a.uniforms.bandPitchPx).toBe(BAND_UNIFORMS.bandPitchPx)
    expect(b.uniforms.trackSplit).toBe(a.uniforms.trackSplit)
    expect(a.uniforms.linewidth!.value).toBe(2)
    expect(a.vertexShader).toContain('bandShift(')
  })
})
