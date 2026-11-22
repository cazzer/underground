/**
 * LineMaterial for every basemap class, with three factors on its fragment alpha (a fragment at 0 is discarded):
 * - the street mask (src/lib/basemap/streetMask.ts): inside the focused station's street radius a road fades out as the
 *   station's own streets fade in. MASK_GLSL is maskAlpha's twin. Road materials share one MaskUniforms by reference,
 *   so one write per frame (Basemap.tsx) moves them all; water and parks get their own, left at strength 0.
 * - the network fade and the bbox edge (src/lib/basemap/edgeFade.ts): the basemap thins out away from the subway and
 *   stops at the spec bbox. NETWORK_GLSL and EDGE_GLSL are networkAlpha's and edgeAlpha's twins. One ExtentUniforms is
 *   shared by every class; Basemap writes the edge width per frame.
 * Change a twin and its GLSL together. It never reads the band view and stays out of BAND_UNIFORMS.
 */
import { Vector2, Vector3, Vector4, type IUniform } from 'three'
import { LineMaterial, type LineMaterialParameters } from 'three/examples/jsm/lines/LineMaterial.js'
import type { SceneBox } from '../lib/basemap/edgeFade'
import { HULL_MAX_EDGES, type HullEdge } from '../lib/basemap/networkHull'
import { replaceOnce, type PatchOwner } from './bandLineMaterial'

const OWNER: PatchOwner = { label: 'Basemap shader', file: 'basemapLineMaterial.ts' }

export interface MaskUniforms {
  maskCenter: IUniform<Vector2>
  maskInner: IUniform<number>
  maskOuter: IUniform<number>
  /** The station street layer's opacity; 0 leaves every road as drawn. */
  maskStrength: IUniform<number>
}

export function createMaskUniforms(): MaskUniforms {
  return { maskCenter: { value: new Vector2() }, maskInner: { value: 0 }, maskOuter: { value: 0 }, maskStrength: { value: 0 } }
}

export interface ExtentUniforms {
  /** The spec bbox in scene meters: (minX, maxX, minZ, maxZ). */
  edgeBox: IUniform<Vector4>
  /** The bbox edge fade's width (edgeFadeFor), written per frame. */
  edgeFadeM: IUniform<number>
  /** The network outline's half-planes (networkHull.ts): (nx, nz, c) each, HULL_MAX_EDGES of them. */
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
  if (hull.length !== HULL_MAX_EDGES) throw new Error(`The network hull must have ${HULL_MAX_EDGES} edges, got ${hull.length}`)
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
 * The mask and edge factors read quantities linear in the ground point (the offset from the mask center, distances
 * inside the bbox sides), so they are computed per segment end and interpolate exactly; the distance outside the
 * network outline is a max of linear terms, so along a long segment crossing a hull corner it interpolates slightly
 * high (a touch more fade), which a 7 km fade hides. Working in offsets also keeps the fragment shader's numbers small.
 */
const VERT_GLSL = /* glsl */ `
uniform vec2 maskCenter;
uniform vec4 edgeBox;
uniform vec3 netEdges[ ${HULL_MAX_EDGES} ];
varying vec2 vMaskOffset;
varying vec4 vEdgeInside;
varying float vNetOutside;
`

const VERT_MAIN_GLSL = /* glsl */ `
vec2 groundXZ = ( modelMatrix * vec4( position.y < 0.5 ? instanceStart : instanceEnd, 1.0 ) ).xz;
vMaskOffset = groundXZ - maskCenter;
vEdgeInside = vec4( groundXZ.x - edgeBox.x, edgeBox.y - groundXZ.x, groundXZ.y - edgeBox.z, edgeBox.w - groundXZ.y );
vNetOutside = - 1e9;
for ( int i = 0; i < ${HULL_MAX_EDGES}; i ++ ) vNetOutside = max( vNetOutside, dot( netEdges[ i ].xy, groundXZ ) - netEdges[ i ].z );
`

export const MASK_GLSL = /* glsl */ `
uniform float maskInner;
uniform float maskOuter;
uniform float maskStrength;
varying vec2 vMaskOffset;

float basemapMask() {
	float ramp = clamp( ( length( vMaskOffset ) - maskInner ) / max( maskOuter - maskInner, 1e-3 ), 0.0, 1.0 );
	return 1.0 - maskStrength * ( 1.0 - ramp );
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

/** LineMaterial's vertex shader passing on each fragment's mask offset, bbox distances and distance outside the network. Throws on a moved anchor. */
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
  }
}
