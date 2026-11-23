import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { describe, expect, it } from 'vitest'
import { edgeAlpha, networkAlpha } from '../lib/basemap/edgeFade'
import { networkHull } from '../lib/basemap/networkHull'
import { claimMaskSlot, createStreetMask, MASK_N, maskAlphaAt, maskInner, releaseMaskSlot, writeMaskSlot, type MaskDisc } from '../lib/basemap/streetMask'
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
  writeMaskUniforms,
} from './basemapLineMaterial'

const BOX = { minX: -20_000, maxX: 25_000, minZ: -30_000, maxZ: 20_000 }
const NET = networkHull([{ x: -14_000, z: -24_000 }, { x: 16_000, z: -24_000 }, { x: 16_000, z: 20_000 }, { x: -2000, z: 26_000 }])

describe('basemap shader patches', () => {
  const plain = new LineMaterial()

  it("patch the installed three's LineMaterial shaders once each", () => {
    const vert = patchBasemapVertex(plain.vertexShader)
    for (const name of ['vGround', 'vEdgeInside']) expect(vert.match(new RegExp(`${name} = `, 'g')), name).toHaveLength(1)
    // Written after both segment ends are read, inside main.
    expect(vert.indexOf('vGround = ')).toBeGreaterThan(vert.indexOf('void main()'))
    expect(vert).toContain('vGround = groundXZ;')
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

/** MASK_GLSL's loop, ported line by line over the uniforms, so the shader and maskAlphaAt can't drift apart. */
function maskPort(x: number, z: number, discs: readonly (readonly number[])[], strength: readonly number[]): number {
  let a = 1
  for (let i = 0; i < MASK_N; i++) {
    const [dx, dz, dInner, dOuter] = discs[i] as [number, number, number, number]
    const ramp = Math.min(Math.max((Math.hypot(x - dx, z - dz) - dInner) / Math.max(dOuter - dInner, 1e-3), 0), 1)
    a = Math.min(a, 1 - strength[i]! * (1 - ramp))
  }
  return a
}

/** These discs written through a mask into uniforms (read back as plain arrays), and the discs maskAlphaAt reads. */
function maskCase(discs: readonly { x: number; z: number; radiusM: number }[], strength: number) {
  const mask = createStreetMask()
  for (const d of discs) writeMaskSlot(mask, claimMaskSlot(mask)!, d.x, d.z, d.radiusM)
  const uniforms = createMaskUniforms()
  writeMaskUniforms(uniforms, mask, strength)
  const twin: MaskDisc[] = discs.map((d) => ({ x: d.x, z: d.z, inner: maskInner(d.radiusM), outer: d.radiusM, strength }))
  return { discs: uniforms.maskDiscs.value.map((v) => v.toArray()), strength: uniforms.maskStrength.value, twin }
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
  it('MASK_GLSL is the loop maskAlphaAt computes, for no, one and several discs', () => {
    expect(MASK_GLSL).toContain('uniform vec4 maskDiscs[ MASK_N ];')
    expect(MASK_GLSL).toContain('uniform float maskStrength[ MASK_N ];')
    expect(MASK_GLSL).toContain('float a = 1.0;')
    expect(MASK_GLSL).toContain('for ( int i = 0; i < MASK_N; i ++ ) {')
    expect(MASK_GLSL).toContain('float ramp = clamp( ( length( vGround - disc.xy ) - disc.z ) / max( disc.w - disc.z, 1e-3 ), 0.0, 1.0 );')
    expect(MASK_GLSL).toContain('a = min( a, 1.0 - maskStrength[ i ] * ( 1.0 - ramp ) );')
    const cases = [
      [],
      [{ x: 100, z: -50, radiusM: 300 }],
      [{ x: 0, z: 0, radiusM: 0 }],
      [{ x: 0, z: 0, radiusM: 300 }, { x: 450, z: 0, radiusM: 200 }, { x: -2000, z: 900, radiusM: 50 }],
      [{ x: 0, z: 0, radiusM: 300 }, { x: 450, z: 0, radiusM: 200 }, { x: 0, z: 400, radiusM: 300 }, { x: 5000, z: 5000, radiusM: 300 }],
    ]
    const points = [[0, 0], [100, -50], [260, 0], [330, 0], [400, 0], [450, 120], [0, 300], [-1990, 900], [5, 0], [9000, 9000]] as const
    for (const discs of cases) {
      for (const strength of [1, 0.5, 0]) {
        const c = maskCase(discs, strength)
        for (const [x, z] of points) {
          expect(maskAlphaAt(x, z, c.twin), `${discs.length} discs at ${x},${z} s ${strength}`).toBeCloseTo(maskPort(x, z, c.discs, c.strength), 12)
        }
      }
    }
    // One disc gives the single-disc formula the mask had before slots, so one station draws as it did.
    const one = maskCase([{ x: 100, z: -50, radiusM: 300 }], 0.8)
    expect(maskPort(100 + 260, -50, one.discs, one.strength)).toBeCloseTo(1 - 0.8 * (1 - (260 - 230) / 70), 12)
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
    expect(a.defines.MASK_N).toBe(MASK_N)
    expect(a.uniforms.maskDiscs!.value).toHaveLength(MASK_N)
    expect(a.uniforms.netEdges!.value[0].toArray()).toEqual([NET[0]!.nx, NET[0]!.nz, NET[0]!.c])
    expect(a.uniforms.linewidth!.value).toBe(2)
    for (const key of Object.keys(BAND_UNIFORMS)) expect(a.uniforms[key], key).toBeUndefined()
    expect(a.vertexShader).not.toContain('bandShift(')
  })
})

describe('writeMaskUniforms', () => {
  it('writes each present slot at the strength and leaves the free ones at 0, so two layers never clobber each other', () => {
    const mask = createStreetMask()
    const [a, b] = [claimMaskSlot(mask)!, claimMaskSlot(mask)!]
    writeMaskSlot(mask, a, 10, 20, 300)
    writeMaskSlot(mask, b, -500, 40, 150)
    const uniforms = createMaskUniforms()
    writeMaskUniforms(uniforms, mask, 0.7)
    expect(uniforms.maskDiscs.value[a]!.toArray()).toEqual([10, 20, 230, 300])
    expect(uniforms.maskDiscs.value[b]!.toArray()).toEqual([-500, 40, 80, 150])
    expect(uniforms.maskStrength.value).toEqual([0.7, 0.7, 0, 0])
    releaseMaskSlot(mask, a)
    writeMaskUniforms(uniforms, mask, 0.7)
    expect(uniforms.maskStrength.value).toEqual([0, 0.7, 0, 0])
    expect(uniforms.maskDiscs.value[b]!.toArray()).toEqual([-500, 40, 80, 150])
  })
})
