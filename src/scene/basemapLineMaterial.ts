/**
 * LineMaterial for the basemap's road classes, with the street mask (src/lib/basemap/streetMask.ts) on its fragment
 * alpha: inside the focused station's street radius a road fades out as the station's own streets fade in, and a
 * fully masked fragment is discarded. MASK_GLSL is maskAlpha's twin; change both together. The mask uniforms are
 * shared by reference across the road materials, so one write per frame (Basemap.tsx) moves them all. It never
 * reads the band view and stays out of BAND_UNIFORMS.
 */
import { Vector2, type IUniform } from 'three'
import { LineMaterial, type LineMaterialParameters } from 'three/examples/jsm/lines/LineMaterial.js'
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

const VERT_DECLARE_ANCHOR = 'attribute vec3 instanceEnd;'
const VERT_END_ANCHOR = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );'
const FRAG_DECLARE_ANCHOR = 'uniform float opacity;'
const FRAG_COLOR_ANCHOR = 'gl_FragColor = vec4( diffuseColor.rgb, alpha );'

/**
 * The fragment's ground offset from the mask center is interpolated from the segment ends (world xz minus the center
 * in the vertex shader, so a far-off tile keeps its precision under mediump).
 */
const VERT_GLSL = /* glsl */ `
uniform vec2 maskCenter;
varying vec2 vMaskOffset;
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

/** LineMaterial's vertex shader passing on each fragment's ground offset from the mask center. Throws on a moved anchor. */
export function patchMaskVertex(src: string): string {
  const out = replaceOnce(src, VERT_DECLARE_ANCHOR, `${VERT_DECLARE_ANCHOR}\n${VERT_GLSL}`)
  return replaceOnce(
    out,
    VERT_END_ANCHOR,
    `${VERT_END_ANCHOR}\n` +
      'vMaskOffset = ( modelMatrix * vec4( position.y < 0.5 ? instanceStart : instanceEnd, 1.0 ) ).xz - maskCenter;',
  )
}

/** LineMaterial's fragment shader with the mask on its alpha. Throws on a moved anchor. */
export function patchMaskFragment(src: string): string {
  const out = replaceOnce(src, FRAG_DECLARE_ANCHOR, `${FRAG_DECLARE_ANCHOR}\n${MASK_GLSL}`)
  return replaceOnce(
    out,
    FRAG_COLOR_ANCHOR,
    'float roadMask = basemapMask();\nif ( roadMask <= 0.0 ) discard;\ngl_FragColor = vec4( diffuseColor.rgb, alpha * roadMask );',
  )
}

export class BasemapLineMaterial extends LineMaterial {
  constructor(mask: MaskUniforms, parameters?: LineMaterialParameters) {
    super(parameters)
    this.vertexShader = patchMaskVertex(this.vertexShader)
    this.fragmentShader = patchMaskFragment(this.fragmentShader)
    Object.assign(this.uniforms, mask)
  }
}
