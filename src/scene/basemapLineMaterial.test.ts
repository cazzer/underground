import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { describe, expect, it } from 'vitest'
import { maskAlpha } from '../lib/basemap/streetMask'
import { BAND_UNIFORMS } from './bandLineMaterial'
import { BasemapLineMaterial, createMaskUniforms, MASK_GLSL, patchMaskFragment, patchMaskVertex } from './basemapLineMaterial'

describe('basemap mask patches', () => {
  const plain = new LineMaterial()

  it("patch the installed three's LineMaterial shaders once each", () => {
    const vert = patchMaskVertex(plain.vertexShader)
    expect(vert.match(/vMaskOffset = /g)).toHaveLength(1)
    // Written after both segment ends are read, inside main.
    expect(vert.indexOf('vMaskOffset = ')).toBeGreaterThan(vert.indexOf('void main()'))
    const frag = patchMaskFragment(plain.fragmentShader)
    expect(frag).toContain('gl_FragColor = vec4( diffuseColor.rgb, alpha * roadMask );')
    expect(frag).not.toContain('gl_FragColor = vec4( diffuseColor.rgb, alpha );')
    expect(frag.indexOf('float basemapMask()')).toBeLessThan(frag.indexOf('void main()'))
  })

  it('throw when an anchor is missing or repeated', () => {
    expect(() => patchMaskVertex('void main() {}')).toThrow(/exactly one/)
    expect(() => patchMaskVertex(plain.vertexShader + plain.vertexShader)).toThrow(/exactly one/)
    expect(() => patchMaskFragment('void main() {}')).toThrow(/exactly one/)
    expect(() => patchMaskFragment(plain.fragmentShader + plain.fragmentShader)).toThrow(/exactly one/)
  })
})

/** MASK_GLSL's formula, ported line by line, so the shader and maskAlpha can't drift apart. */
function glslPort(r: number, inner: number, outer: number, strength: number): number {
  const ramp = Math.min(Math.max((r - inner) / Math.max(outer - inner, 1e-3), 0), 1)
  return 1 - strength * (1 - ramp)
}

describe('MASK_GLSL', () => {
  it('is the formula maskAlpha computes', () => {
    expect(MASK_GLSL).toContain('float ramp = clamp( ( length( vMaskOffset ) - maskInner ) / max( maskOuter - maskInner, 1e-3 ), 0.0, 1.0 );')
    expect(MASK_GLSL).toContain('return 1.0 - maskStrength * ( 1.0 - ramp );')
    for (const [r, inner, outer, s] of [[0, 230, 300, 1], [260, 230, 300, 0.5], [400, 230, 300, 1], [5, 0, 0, 1]] as const) {
      expect(maskAlpha(r, inner, outer, s)).toBe(glslPort(r, inner, outer, s))
    }
  })
})

describe('BasemapLineMaterial', () => {
  it('shares the mask uniforms by reference and keeps out of the band uniforms', () => {
    const mask = createMaskUniforms()
    const a = new BasemapLineMaterial(mask, { linewidth: 2 })
    const b = new BasemapLineMaterial(mask)
    expect(a.uniforms.maskStrength).toBe(mask.maskStrength)
    expect(b.uniforms.maskCenter).toBe(a.uniforms.maskCenter)
    expect(a.uniforms.linewidth!.value).toBe(2)
    for (const key of Object.keys(BAND_UNIFORMS)) expect(a.uniforms[key], key).toBeUndefined()
    expect(a.vertexShader).not.toContain('bandShift(')
  })
})
