import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { describe, expect, it } from 'vitest'
import { edgeAlpha } from '../lib/basemap/edgeFade'
import { maskAlpha } from '../lib/basemap/streetMask'
import { BAND_UNIFORMS } from './bandLineMaterial'
import {
  BasemapLineMaterial,
  createEdgeUniforms,
  createMaskUniforms,
  EDGE_GLSL,
  MASK_GLSL,
  patchBasemapFragment,
  patchBasemapVertex,
} from './basemapLineMaterial'

const BOX = { minX: -20_000, maxX: 25_000, minZ: -30_000, maxZ: 20_000 }

describe('basemap shader patches', () => {
  const plain = new LineMaterial()

  it("patch the installed three's LineMaterial shaders once each", () => {
    const vert = patchBasemapVertex(plain.vertexShader)
    expect(vert.match(/vMaskOffset = /g)).toHaveLength(1)
    expect(vert.match(/vEdgeInside = /g)).toHaveLength(1)
    // Written after both segment ends are read, inside main.
    expect(vert.indexOf('vMaskOffset = ')).toBeGreaterThan(vert.indexOf('void main()'))
    const frag = patchBasemapFragment(plain.fragmentShader)
    expect(frag).toContain('float basemapAlpha = basemapMask() * basemapEdge();')
    expect(frag).toContain('gl_FragColor = vec4( diffuseColor.rgb, alpha * basemapAlpha );')
    expect(frag).not.toContain('gl_FragColor = vec4( diffuseColor.rgb, alpha );')
    expect(frag.indexOf('float basemapEdge()')).toBeLessThan(frag.indexOf('void main()'))
  })

  it('throw when an anchor is missing or repeated', () => {
    expect(() => patchBasemapVertex('void main() {}')).toThrow(/exactly one/)
    expect(() => patchBasemapVertex(plain.vertexShader + plain.vertexShader)).toThrow(/exactly one/)
    expect(() => patchBasemapFragment('void main() {}')).toThrow(/exactly one/)
    expect(() => patchBasemapFragment(plain.fragmentShader + plain.fragmentShader)).toThrow(/exactly one/)
  })
})

/** MASK_GLSL's formula, ported line by line, so the shader and maskAlpha can't drift apart. */
function maskPort(r: number, inner: number, outer: number, strength: number): number {
  const ramp = Math.min(Math.max((r - inner) / Math.max(outer - inner, 1e-3), 0), 1)
  return 1 - strength * (1 - ramp)
}

/** EDGE_GLSL ported: the vertex shader's four inside distances, their min, then the smoothstep. */
function edgePort(x: number, z: number, fadeM: number): number {
  const inside = [x - BOX.minX, BOX.maxX - x, z - BOX.minZ, BOX.maxZ - z] as const
  const d = Math.min(Math.min(inside[0], inside[1]), Math.min(inside[2], inside[3]))
  const t = Math.min(Math.max(d / fadeM, 0), 1)
  return t * t * (3 - 2 * t)
}

describe('the GLSL twins', () => {
  it('MASK_GLSL is the formula maskAlpha computes', () => {
    expect(MASK_GLSL).toContain('float ramp = clamp( ( length( vMaskOffset ) - maskInner ) / max( maskOuter - maskInner, 1e-3 ), 0.0, 1.0 );')
    expect(MASK_GLSL).toContain('return 1.0 - maskStrength * ( 1.0 - ramp );')
    for (const [r, inner, outer, s] of [[0, 230, 300, 1], [260, 230, 300, 0.5], [400, 230, 300, 1], [5, 0, 0, 1]] as const) {
      expect(maskAlpha(r, inner, outer, s)).toBe(maskPort(r, inner, outer, s))
    }
  })

  it('EDGE_GLSL is the formula edgeAlpha computes', () => {
    expect(EDGE_GLSL).toContain('float d = min( min( vEdgeInside.x, vEdgeInside.y ), min( vEdgeInside.z, vEdgeInside.w ) );')
    expect(EDGE_GLSL).toContain('float t = clamp( d / edgeFadeM, 0.0, 1.0 );')
    expect(EDGE_GLSL).toContain('return t * t * ( 3.0 - 2.0 * t );')
    for (const [x, z] of [[0, 0], [-19_000, 0], [24_500, 19_900], [-25_000, 0], [1000, -28_500]] as const) {
      expect(edgeAlpha(x, z, BOX, 3000)).toBe(edgePort(x, z, 3000))
    }
  })
})

describe('BasemapLineMaterial', () => {
  it('shares the mask and edge uniforms by reference and keeps out of the band uniforms', () => {
    const mask = createMaskUniforms()
    const edge = createEdgeUniforms(BOX, 3000)
    const a = new BasemapLineMaterial(mask, edge, { linewidth: 2 })
    const b = new BasemapLineMaterial(createMaskUniforms(), edge)
    expect(a.uniforms.maskStrength).toBe(mask.maskStrength)
    expect(b.uniforms.edgeBox).toBe(a.uniforms.edgeBox)
    expect(b.uniforms.maskStrength).not.toBe(a.uniforms.maskStrength)
    expect(a.uniforms.edgeBox!.value.toArray()).toEqual([BOX.minX, BOX.maxX, BOX.minZ, BOX.maxZ])
    expect(a.uniforms.linewidth!.value).toBe(2)
    for (const key of Object.keys(BAND_UNIFORMS)) expect(a.uniforms[key], key).toBeUndefined()
    expect(a.vertexShader).not.toContain('bandShift(')
  })
})
