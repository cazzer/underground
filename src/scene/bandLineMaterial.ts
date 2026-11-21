/**
 * LineMaterial with the band offset (src/lib/bandOffset.ts) applied in its vertex shader: each segment end moves
 * sideways along its miter normal by `band` pitches of screen pixels, and back toward the centerline while the two
 * direction tracks are too close on screen for both bundles. BAND_GLSL is bandShift's twin; change both together.
 */
import type { IUniform } from 'three'
import { LineMaterial, type LineMaterialParameters } from 'three/examples/jsm/lines/LineMaterial.js'
import { MIN_FORESHORTEN, TRACK_MERGE_PX, TRACK_SPLIT_PX } from '../lib/bandOffset'

/** Shared by every band material, so one per-frame write (SubwayLines) moves them all. */
export const BAND_UNIFORMS = {
  bandPitchPx: { value: 0 },
  trackOffsetM: { value: 0 },
  /** The revealed interior's opacity: segments with a platform fade weight (platformMask.ts) fade by it. */
  platformFade: { value: 0 },
} satisfies Record<string, IUniform<number>>

/** Per-segment attribute names: (mx, mz, band, half) at the start and at the end (LineBuffers.bands). */
export const BAND_START = 'instanceBandStart'
export const BAND_END = 'instanceBandEnd'
/** Per-segment platform fade weight at the start and the end (vec2); a layer without it never fades. */
export const FADE_ATTRIBUTE = 'instanceFade'

const DECLARE_ANCHOR = 'attribute vec3 instanceEnd;'
const START_ANCHOR = 'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );'
const END_ANCHOR = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );'

const glslFloat = (v: number) => v.toFixed(4)

/** bandShift (bandOffset.ts) in GLSL; `resolution` is LineMaterial's, in CSS pixels. */
export const BAND_GLSL = /* glsl */ `
uniform float bandPitchPx;
uniform float trackOffsetM;
uniform float platformFade;
attribute vec4 ${BAND_START};
attribute vec4 ${BAND_END};
attribute vec2 ${FADE_ATTRIBUTE};
varying float vBandFade;

vec3 bandShift( vec3 p, vec4 b ) {
	float miter = length( b.xy );
	if ( miter == 0.0 ) return p;
	vec2 n = b.xy / miter;
	vec3 pv = ( modelViewMatrix * vec4( p, 1.0 ) ).xyz;
	float w = max( - pv.z, 1e-3 );
	vec2 q = pv.xy / w;
	vec3 nv = mat3( modelViewMatrix ) * vec3( n.x, 0.0, n.y );
	vec3 tv = mat3( modelViewMatrix ) * vec3( n.y, 0.0, - n.x );
	vec2 ns = nv.xy + q * nv.z;
	vec2 ts = tv.xy + q * tv.z;
	float cross2 = abs( ts.x * ns.y - ts.y * ns.x );
	float k = 2.0 / ( projectionMatrix[ 1 ][ 1 ] * resolution.y );
	float metersPerPx = k * w * length( ts ) / max( cross2, ${glslFloat(MIN_FORESHORTEN)} );
	float bundlePx = 2.0 * b.w * bandPitchPx;
	float split = smoothstep( ${glslFloat(TRACK_MERGE_PX)} + bundlePx, ${glslFloat(TRACK_SPLIT_PX)} + bundlePx, 2.0 * trackOffsetM / metersPerPx );
	float s = miter * ( b.z * bandPitchPx * metersPerPx - trackOffsetM * ( 1.0 - split ) );
	return p + vec3( n.x, 0.0, n.y ) * s;
}
`

function replaceOnce(src: string, anchor: string, by: string): string {
  const at = src.indexOf(anchor)
  if (at < 0 || src.indexOf(anchor, at + anchor.length) >= 0) {
    throw new Error(`Band shader: LineMaterial's shader no longer has exactly one "${anchor}"; update bandLineMaterial.ts`)
  }
  return src.slice(0, at) + by + src.slice(at + anchor.length)
}

/**
 * LineMaterial's vertex shader with the band offset on both segment ends and the platform fade passed on. Throws
 * if three changed the anchors.
 */
export function patchBandShader(src: string): string {
  let out = replaceOnce(src, DECLARE_ANCHOR, `${DECLARE_ANCHOR}\n${BAND_GLSL}`)
  out = replaceOnce(out, START_ANCHOR, `vec4 start = modelViewMatrix * vec4( bandShift( instanceStart, ${BAND_START} ), 1.0 );`)
  return replaceOnce(
    out,
    END_ANCHOR,
    `vec4 end = modelViewMatrix * vec4( bandShift( instanceEnd, ${BAND_END} ), 1.0 );\n` +
      `vBandFade = 1.0 - platformFade * ( position.y < 0.5 ? ${FADE_ATTRIBUTE}.x : ${FADE_ATTRIBUTE}.y );`,
  )
}

const FRAG_DECLARE_ANCHOR = 'uniform float opacity;'
const FRAG_COLOR_ANCHOR = 'gl_FragColor = vec4( diffuseColor.rgb, alpha );'

/** LineMaterial's fragment shader with the platform fade on its alpha. Throws if three changed the anchors. */
export function patchBandFragment(src: string): string {
  const out = replaceOnce(src, FRAG_DECLARE_ANCHOR, `${FRAG_DECLARE_ANCHOR}\nvarying float vBandFade;`)
  return replaceOnce(out, FRAG_COLOR_ANCHOR, 'gl_FragColor = vec4( diffuseColor.rgb, alpha * vBandFade );')
}

/** Needs the two band attributes on its geometry (useLineLayer adds them). */
export class BandLineMaterial extends LineMaterial {
  constructor(parameters?: LineMaterialParameters) {
    super(parameters)
    this.vertexShader = patchBandShader(this.vertexShader)
    this.fragmentShader = patchBandFragment(this.fragmentShader)
    Object.assign(this.uniforms, BAND_UNIFORMS)
  }
}
