/**
 * LineMaterial for every basemap class, with two factors on its fragment alpha (a fragment at 0 is discarded):
 * - the street mask (src/lib/basemap/streetMask.ts): inside the focused station's street radius a road fades out as the
 *   station's own streets fade in. MASK_GLSL is maskAlpha's twin. Road materials share one MaskUniforms by reference,
 *   so one write per frame (Basemap.tsx) moves them all; water and parks get their own, left at strength 0.
 * - the bbox edge fade (src/lib/basemap/edgeFade.ts): gone at the spec bbox edge, so no hard tile edge shows.
 *   EDGE_GLSL is edgeAlpha's twin. One EdgeUniforms is shared by every class.
 * Change a twin and its GLSL together. It never reads the band view and stays out of BAND_UNIFORMS.
 */
import { Vector2, Vector4, type IUniform } from 'three'
import { LineMaterial, type LineMaterialParameters } from 'three/examples/jsm/lines/LineMaterial.js'
import type { SceneBox } from '../lib/basemap/edgeFade'
import { replaceOnce } from './bandLineMaterial'

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

export interface EdgeUniforms {
  /** The bbox in scene meters: (minX, maxX, minZ, maxZ). */
  edgeBox: IUniform<Vector4>
  edgeFadeM: IUniform<number>
}

export function createEdgeUniforms(box: SceneBox, fadeM: number): EdgeUniforms {
  return { edgeBox: { value: new Vector4(box.minX, box.maxX, box.minZ, box.maxZ) }, edgeFadeM: { value: fadeM } }
}

const VERT_DECLARE_ANCHOR = 'attribute vec3 instanceEnd;'
const VERT_END_ANCHOR = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );'
const FRAG_DECLARE_ANCHOR = 'uniform float opacity;'
const FRAG_COLOR_ANCHOR = 'gl_FragColor = vec4( diffuseColor.rgb, alpha );'

/**
 * Both factors read quantities linear in the ground point, so they are computed per segment end and interpolated
 * exactly: the offset from the mask center, and the four distances inside the bbox's sides. Small numbers, so a
 * far-off tile keeps its precision under mediump.
 */
const VERT_GLSL = /* glsl */ `
uniform vec2 maskCenter;
uniform vec4 edgeBox;
varying vec2 vMaskOffset;
varying vec4 vEdgeInside;
`

const VERT_MAIN_GLSL = /* glsl */ `
vec2 groundXZ = ( modelMatrix * vec4( position.y < 0.5 ? instanceStart : instanceEnd, 1.0 ) ).xz;
vMaskOffset = groundXZ - maskCenter;
vEdgeInside = vec4( groundXZ.x - edgeBox.x, edgeBox.y - groundXZ.x, groundXZ.y - edgeBox.z, edgeBox.w - groundXZ.y );
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

/** LineMaterial's vertex shader passing on each fragment's mask offset and bbox distances. Throws on a moved anchor. */
export function patchBasemapVertex(src: string): string {
  const out = replaceOnce(src, VERT_DECLARE_ANCHOR, `${VERT_DECLARE_ANCHOR}\n${VERT_GLSL}`)
  return replaceOnce(out, VERT_END_ANCHOR, `${VERT_END_ANCHOR}\n${VERT_MAIN_GLSL}`)
}

/** LineMaterial's fragment shader with the mask and the edge fade on its alpha. Throws on a moved anchor. */
export function patchBasemapFragment(src: string): string {
  const out = replaceOnce(src, FRAG_DECLARE_ANCHOR, `${FRAG_DECLARE_ANCHOR}\n${MASK_GLSL}\n${EDGE_GLSL}`)
  return replaceOnce(
    out,
    FRAG_COLOR_ANCHOR,
    'float basemapAlpha = basemapMask() * basemapEdge();\nif ( basemapAlpha <= 0.0 ) discard;\n' +
      'gl_FragColor = vec4( diffuseColor.rgb, alpha * basemapAlpha );',
  )
}

export class BasemapLineMaterial extends LineMaterial {
  constructor(mask: MaskUniforms, edge: EdgeUniforms, parameters?: LineMaterialParameters) {
    super(parameters)
    this.vertexShader = patchBasemapVertex(this.vertexShader)
    this.fragmentShader = patchBasemapFragment(this.fragmentShader)
    Object.assign(this.uniforms, mask, edge)
  }
}
