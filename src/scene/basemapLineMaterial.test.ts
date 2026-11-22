import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { describe, expect, it } from 'vitest'
import { edgeAlpha, networkAlpha } from '../lib/basemap/edgeFade'
import { networkHull } from '../lib/basemap/networkHull'
import { maskAlpha } from '../lib/basemap/streetMask'
import { BAND_UNIFORMS } from './bandLineMaterial'
import {
  BasemapLineMaterial,
  createExtentUniforms,
  createMaskUniforms,
  EDGE_GLSL,
  MASK_GLSL,
  NETWORK_GLSL,
  patchBasemapFragment,
  patchBasemapVertex,
} from './basemapLineMaterial'

const BOX = { minX: -20_000, maxX: 25_000, minZ: -30_000, maxZ: 20_000 }
const NET = networkHull([{ x: -14_000, z: -24_000 }, { x: 16_000, z: -24_000 }, { x: 16_000, z: 20_000 }, { x: -2000, z: 26_000 }])

describe('basemap shader patches', () => {
  const plain = new LineMaterial()

  it("patch the installed three's LineMaterial shaders once each", () => {
    const vert = patchBasemapVertex(plain.vertexShader)
    for (const name of ['vMaskOffset', 'vEdgeInside']) expect(vert.match(new RegExp(`${name} = `, 'g')), name).toHaveLength(1)
    // Written after both segment ends are read, inside main.
    expect(vert.indexOf('vMaskOffset = ')).toBeGreaterThan(vert.indexOf('void main()'))
    const frag = patchBasemapFragment(plain.fragmentShader)
    expect(frag).toContain('float basemapAlpha = basemapMask() * basemapEdge() * basemapNetwork();')
    expect(frag).toContain('gl_FragColor = vec4( diffuseColor.rgb, alpha * basemapAlpha );')
    expect(frag).not.toContain('gl_FragColor = vec4( diffuseColor.rgb, alpha );')
    expect(frag.indexOf('float basemapNetwork()')).toBeLessThan(frag.indexOf('void main()'))
  })

  it('throw, naming this file, when an anchor is missing or repeated', () => {
    expect(() => patchBasemapVertex('void main() {}')).toThrow(/^Basemap shader: .*exactly one.*basemapLineMaterial\.ts$/)
    expect(() => patchBasemapVertex(plain.vertexShader + plain.vertexShader)).toThrow(/Basemap shader/)
    expect(() => patchBasemapFragment('void main() {}')).toThrow(/Basemap shader/)
    expect(() => patchBasemapFragment(plain.fragmentShader + plain.fragmentShader)).toThrow(/Basemap shader/)
  })
})

const smoothstep = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1)
  return c * c * (3 - 2 * c)
}

/** MASK_GLSL's formula, ported line by line, so the shader and maskAlpha can't drift apart. */
function maskPort(r: number, inner: number, outer: number, strength: number): number {
  const ramp = Math.min(Math.max((r - inner) / Math.max(outer - inner, 1e-3), 0), 1)
  return 1 - strength * (1 - ramp)
}

/** EDGE_GLSL ported: the vertex shader's four inside distances, their min, then the smoothstep. */
function edgePort(x: number, z: number, fadeM: number): number {
  const inside = [x - BOX.minX, BOX.maxX - x, z - BOX.minZ, BOX.maxZ - z] as const
  return smoothstep(Math.min(Math.min(inside[0], inside[1]), Math.min(inside[2], inside[3])) / fadeM)
}

/** NETWORK_GLSL ported: the vertex shader's max over the edge terms from -1e9, then 1 - smoothstep past the pad. */
function networkPort(x: number, z: number, padM: number, fadeM: number): number {
  let outside = -1e9
  for (const e of NET) outside = Math.max(outside, e.nx * x + e.nz * z - e.c)
  return 1 - smoothstep((outside - padM) / fadeM)
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
    for (const [x, z, f] of [[0, 0, 3000], [-19_000, 0, 3000], [24_950, 19_900, 100], [-25_000, 0, 3000], [1000, -28_500, 3000]] as const) {
      expect(edgeAlpha(x, z, BOX, f)).toBeCloseTo(edgePort(x, z, f), 12)
    }
  })

  it('NETWORK_GLSL is the formula networkAlpha computes', () => {
    expect(patchBasemapVertex(new LineMaterial().vertexShader)).toContain(
      'vNetOutside = max( vNetOutside, dot( netEdges[ i ].xy, groundXZ ) - netEdges[ i ].z );',
    )
    expect(NETWORK_GLSL).toContain('float t = clamp( ( vNetOutside - netPadM ) / netFadeM, 0.0, 1.0 );')
    expect(NETWORK_GLSL).toContain('return 1.0 - t * t * ( 3.0 - 2.0 * t );')
    for (const [x, z] of [[0, 0], [22_000, 0], [20_000, 25_000], [-30_000, -40_000], [1000, 33_500]] as const) {
      expect(networkAlpha(x, z, NET, 5000, 7000)).toBeCloseTo(networkPort(x, z, 5000, 7000), 12)
    }
  })
})

describe('BasemapLineMaterial', () => {
  it('shares the mask and extent uniforms by reference and keeps out of the band uniforms', () => {
    const mask = createMaskUniforms()
    const extent = createExtentUniforms(BOX, 3000, NET, 5000, 7000)
    const a = new BasemapLineMaterial(mask, extent, { linewidth: 2 })
    const b = new BasemapLineMaterial(createMaskUniforms(), extent)
    expect(a.uniforms.maskStrength).toBe(mask.maskStrength)
    expect(b.uniforms.edgeFadeM).toBe(a.uniforms.edgeFadeM)
    expect(b.uniforms.netEdges).toBe(a.uniforms.netEdges)
    expect(b.uniforms.maskStrength).not.toBe(a.uniforms.maskStrength)
    expect(a.uniforms.edgeBox!.value.toArray()).toEqual([BOX.minX, BOX.maxX, BOX.minZ, BOX.maxZ])
    expect(a.uniforms.netEdges!.value).toHaveLength(NET.length)
    expect(NET).toHaveLength(4)
    expect(a.defines.NET_EDGES).toBe(4)
    expect(a.uniforms.netEdges!.value[0].toArray()).toEqual([NET[0]!.nx, NET[0]!.nz, NET[0]!.c])
    expect(a.uniforms.linewidth!.value).toBe(2)
    for (const key of Object.keys(BAND_UNIFORMS)) expect(a.uniforms[key], key).toBeUndefined()
    expect(a.vertexShader).not.toContain('bandShift(')
  })
})
