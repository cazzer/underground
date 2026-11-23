/**
 * LineMaterial for every basemap class, with three factors on its fragment alpha (a fragment at 0 is discarded):
 * - the street mask (src/lib/basemap/streetMask.ts): inside any drawn station's street radius (MASK_N discs) a road
 *   fades out as that station's own streets fade in, keeping the least alpha any disc gives it. MASK_GLSL is
 *   maskAlphaAt's twin. Road materials share one MaskUniforms by reference, so one write per frame (Basemap.tsx,
 *   writeMaskUniforms) moves them all; water, parks and paths get their own, left at strength 0.
 * - the network fade and the bbox edge (src/lib/basemap/edgeFade.ts): the basemap thins out away from the subway and
 *   stops at the spec bbox. NETWORK_GLSL and EDGE_GLSL are networkAlpha's and edgeAlpha's twins. One ExtentUniforms is
 *   shared by every class; Basemap writes the edge width per frame.
 * Change a twin and its GLSL together. It never reads the band view and stays out of BAND_UNIFORMS.
 */
import { Vector3, Vector4, type IUniform } from 'three'
import { LineMaterial, type LineMaterialParameters } from 'three/examples/jsm/lines/LineMaterial.js'
import type { SceneBox } from '../lib/basemap/edgeFade'
import { HULL_MAX_EDGES, type HullEdge } from '../lib/basemap/networkHull'
import { MASK_N, maskInner, type StreetMask } from '../lib/basemap/streetMask'
import { replaceOnce, type PatchOwner } from './bandLineMaterial'

const OWNER: PatchOwner = { label: 'Basemap shader', file: 'basemapLineMaterial.ts' }

export interface MaskUniforms {
  /** Per slot (MASK_N): center x, z, then the ramp's start and end (maskInner, radius), scene meters. */
  maskDiscs: IUniform<Vector4[]>
  /** Per slot: its station street layer's opacity (the reveal times its presence); 0 (a free slot) leaves every road as drawn. */
  maskStrength: IUniform<number[]>
}

export function createMaskUniforms(): MaskUniforms {
  return {
    maskDiscs: { value: Array.from({ length: MASK_N }, () => new Vector4()) },
    maskStrength: { value: new Array<number>(MASK_N).fill(0) },
  }
}

/** Copies the mask's present slots into the uniforms at `strength` (the station layers' reveal) times each slot's own
 *  strength (its layer's presence); the rest at 0. Allocates nothing. */
export function writeMaskUniforms(uniforms: MaskUniforms, mask: StreetMask, strength: number): void {
  for (let i = 0; i < MASK_N; i++) {
    const slot = mask.slots[i]!
    if (slot.present) {
      uniforms.maskDiscs.value[i]!.set(slot.x, slot.z, maskInner(slot.radiusM), slot.radiusM)
      uniforms.maskStrength.value[i] = strength * slot.strength
    } else {
      uniforms.maskStrength.value[i] = 0
    }
  }
}

export interface ExtentUniforms {
  /** The spec bbox in scene meters: (minX, maxX, minZ, maxZ). */
  edgeBox: IUniform<Vector4>
  /** The bbox edge fade's width (edgeFadeFor), written per frame. */
  edgeFadeM: IUniform<number>
  /** The network outline's half-planes (networkHull.ts): (nx, nz, c) each; the shader's NET_EDGES is their count. */
  netEdges: IUniform<Vector3[]>
  netPadM: IUniform<number>
  netFadeM: IUniform<number>
}

export function createExtentUniforms(
  edge: SceneBox,
  edgeFadeM: number,
  hull: readonly HullEdge[],
  netPadM: number,
  netFadeM: number,
): ExtentUniforms {
  if (hull.length < 1 || hull.length > HULL_MAX_EDGES) throw new Error(`The network hull must have 1 to ${HULL_MAX_EDGES} edges, got ${hull.length}`)
  return {
    edgeBox: { value: new Vector4(edge.minX, edge.maxX, edge.minZ, edge.maxZ) },
    edgeFadeM: { value: edgeFadeM },
    netEdges: { value: hull.map((e) => new Vector3(e.nx, e.nz, e.c)) },
    netPadM: { value: netPadM },
    netFadeM: { value: netFadeM },
  }
}

const VERT_DECLARE_ANCHOR = 'attribute vec3 instanceEnd;'
const VERT_END_ANCHOR = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );'
const FRAG_DECLARE_ANCHOR = 'uniform float opacity;'
const FRAG_COLOR_ANCHOR = 'gl_FragColor = vec4( diffuseColor.rgb, alpha );'

/**
 * The mask and edge factors read quantities linear in the ground point (the ground point itself, distances inside
 * the bbox sides), so they are computed per segment end and interpolate exactly; the distance outside the network
 * outline is a max of linear terms, so along a long segment crossing a hull corner it interpolates slightly high (a
 * touch more fade), which a 7 km fade hides. The mask reads one ground point for all its discs rather than an offset
 * per disc, so it needs one varying; at tens of km a highp float still resolves millimeters (vEdgeInside's sizes too).
 */
const VERT_GLSL = /* glsl */ `
uniform vec4 edgeBox;
uniform vec3 netEdges[ NET_EDGES ];
varying vec2 vGround;
varying vec4 vEdgeInside;
varying float vNetOutside;
`

const VERT_MAIN_GLSL = /* glsl */ `
vec2 groundXZ = ( modelMatrix * vec4( position.y < 0.5 ? instanceStart : instanceEnd, 1.0 ) ).xz;
vGround = groundXZ;
vEdgeInside = vec4( groundXZ.x - edgeBox.x, edgeBox.y - groundXZ.x, groundXZ.y - edgeBox.z, edgeBox.w - groundXZ.y );
vNetOutside = - 1e9;
for ( int i = 0; i < NET_EDGES; i ++ ) vNetOutside = max( vNetOutside, dot( netEdges[ i ].xy, groundXZ ) - netEdges[ i ].z );
`

export const MASK_GLSL = /* glsl */ `
uniform vec4 maskDiscs[ MASK_N ];
uniform float maskStrength[ MASK_N ];
varying vec2 vGround;

float basemapMask() {
	float a = 1.0;
	for ( int i = 0; i < MASK_N; i ++ ) {
		vec4 disc = maskDiscs[ i ];
		float ramp = clamp( ( length( vGround - disc.xy ) - disc.z ) / max( disc.w - disc.z, 1e-3 ), 0.0, 1.0 );
		a = min( a, 1.0 - maskStrength[ i ] * ( 1.0 - ramp ) );
	}
	return a;
}
`

export const EDGE_GLSL = /* glsl */ `
uniform float edgeFadeM;
varying vec4 vEdgeInside;

float basemapEdge() {
	float d = min( min( vEdgeInside.x, vEdgeInside.y ), min( vEdgeInside.z, vEdgeInside.w ) );
	float t = clamp( d / edgeFadeM, 0.0, 1.0 );
	return t * t * ( 3.0 - 2.0 * t );
}
`

export const NETWORK_GLSL = /* glsl */ `
uniform float netPadM;
uniform float netFadeM;
varying float vNetOutside;

float basemapNetwork() {
	float t = clamp( ( vNetOutside - netPadM ) / netFadeM, 0.0, 1.0 );
	return 1.0 - t * t * ( 3.0 - 2.0 * t );
}
`

/** LineMaterial's vertex shader passing on each fragment's ground point, bbox distances and distance outside the network. Throws on a moved anchor. */
export function patchBasemapVertex(src: string): string {
  const out = replaceOnce(src, VERT_DECLARE_ANCHOR, `${VERT_DECLARE_ANCHOR}\n${VERT_GLSL}`, OWNER)
  return replaceOnce(out, VERT_END_ANCHOR, `${VERT_END_ANCHOR}\n${VERT_MAIN_GLSL}`, OWNER)
}

/** LineMaterial's fragment shader with the mask, network and edge factors on its alpha. Throws on a moved anchor. */
export function patchBasemapFragment(src: string): string {
  const out = replaceOnce(src, FRAG_DECLARE_ANCHOR, `${FRAG_DECLARE_ANCHOR}\n${MASK_GLSL}\n${EDGE_GLSL}\n${NETWORK_GLSL}`, OWNER)
  return replaceOnce(
    out,
    FRAG_COLOR_ANCHOR,
    'float basemapAlpha = basemapMask() * basemapEdge() * basemapNetwork();\nif ( basemapAlpha <= 0.0 ) discard;\n' +
      'gl_FragColor = vec4( diffuseColor.rgb, alpha * basemapAlpha );',
    OWNER,
  )
}

export class BasemapLineMaterial extends LineMaterial {
  constructor(mask: MaskUniforms, extent: ExtentUniforms, parameters?: LineMaterialParameters) {
    super(parameters)
    this.vertexShader = patchBasemapVertex(this.vertexShader)
    this.fragmentShader = patchBasemapFragment(this.fragmentShader)
    Object.assign(this.uniforms, mask, extent)
    // The arrays and their loops are sized to the real hull and the mask's slots; a different count is a different program.
    this.defines = { ...this.defines, NET_EDGES: extent.netEdges.value.length, MASK_N }
  }
}
