import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { describe, expect, it } from 'vitest'
import { BAND_END, BAND_START, BAND_UNIFORMS, BandLineMaterial, patchBandFragment, patchBandShader, WINDOW_ATTRIBUTE } from './bandLineMaterial'

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

  it.each(['attribute vec3 instanceEnd;', 'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );', 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );'])(
    'throws without, or with two of, %s',
    (anchor) => {
      expect(src).toContain(anchor)
      expect(() => patchBandShader(src.replace(anchor, ''))).toThrow(/exactly one/)
      expect(() => patchBandShader(src.replace(anchor, anchor + anchor))).toThrow(/exactly one/)
    },
  )

  it('passes the segment window on only under TRIP_WINDOW', () => {
    const out = patchBandShader(src)
    expect(out).toMatch(new RegExp(`#ifdef TRIP_WINDOW\\nattribute vec2 ${WINDOW_ATTRIBUTE};`))
    expect(out).toContain('vSegT = position.y < 0.5 ? 0.0 : 1.0;')
    expect(out.indexOf('vSegT = ')).toBeGreaterThan(out.indexOf('void main()'))
  })
})

describe('patchBandFragment', () => {
  const src = new LineMaterial().fragmentShader

  it('dims the color, fades the alpha and cuts outside the window', () => {
    const out = patchBandFragment(src)
    expect(out).toContain('gl_FragColor = vec4( dimLine( diffuseColor.rgb ), alpha * vBandFade );')
    expect(out).toContain('#ifdef TRIP_WINDOW\nif ( vSegT < vWindow.x || vSegT > vWindow.y ) discard;\n#endif')
    expect(out.indexOf('vec3 dimLine(')).toBeLessThan(out.indexOf('void main()'))
    expect(out).not.toContain('gl_FragColor = vec4( diffuseColor.rgb, alpha );')
  })

  it.each(['uniform float opacity;', 'gl_FragColor = vec4( diffuseColor.rgb, alpha );'])('throws without, or with two of, %s', (anchor) => {
    expect(src).toContain(anchor)
    expect(() => patchBandFragment(src.replace(anchor, ''))).toThrow(/Band shader/)
    expect(() => patchBandFragment(src.replace(anchor, anchor + anchor))).toThrow(/exactly one/)
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

  it('defines TRIP_WINDOW only on a windowed material', () => {
    expect(new BandLineMaterial({}, { windowed: true }).defines).toHaveProperty('TRIP_WINDOW', '')
    expect(new BandLineMaterial().defines ?? {}).not.toHaveProperty('TRIP_WINDOW')
  })

  it('gives each material its own dim, toward the color it was given in sRGB', () => {
    const a = new BandLineMaterial({}, { dimToward: '#0b2147' })
    const b = new BandLineMaterial()
    expect(a.uniforms.lineDim).not.toBe(b.uniforms.lineDim)
    a.uniforms.lineDim!.value = 0.7
    expect(b.uniforms.lineDim!.value).toBe(0)
    expect(BAND_UNIFORMS).not.toHaveProperty('lineDim')
    expect(a.uniforms.lineDimColor!.value.toArray()).toEqual([11 / 255, 33 / 255, 71 / 255])
  })
})
