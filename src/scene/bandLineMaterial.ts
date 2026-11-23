/**
 * LineMaterial with the band offset (src/lib/bandOffset.ts) applied in its vertex shader: each segment end moves
 * sideways along its miter normal by `band` pitches of screen pixels, and back toward the centerline while the two
 * direction tracks are too close on screen for both bundles. BAND_GLSL is bandShift's twin; change both together.
 */
import { Vector3, type IUniform } from 'three'
import { LineMaterial, type LineMaterialParameters } from 'three/examples/jsm/lines/LineMaterial.js'
import { MIN_FORESHORTEN, TRACK_MERGE_PX, TRACK_SPLIT_PX } from '../lib/bandOffset'
import { srgb01 } from '../lib/lineDim'

/** Shared by every band material, so one per-frame write (SubwayLines) moves them all. */
export const BAND_UNIFORMS = {
  bandPitchPx: { value: 0 },
  bandEase: { value: 1 },
  trackOffsetM: { value: 0 },
  /** The revealed interior's opacity: segments with a platform fade weight (platformMask.ts) fade by it. */
  platformFade: { value: 0 },
} satisfies Record<string, IUniform<number>>

/** Per-segment attribute names: (mx, mz, band, half) at the start and at the end (LineBuffers.bands). */
export const BAND_START = 'instanceBandStart'
export const BAND_END = 'instanceBandEnd'
/** Per-segment platform fade weight at the start and the end (vec2); a layer without it never fades. */
export const FADE_ATTRIBUTE = 'instanceFade'
/** Per-segment (t0, t1) of a windowed layer (TripLines): the fragments outside that stretch of the segment are cut. */
export const WINDOW_ATTRIBUTE = 'instanceWindow'

// A windowed layer's segment parameter: 0 at the start, 1 at the end, so it runs linearly along the segment in the
// world (perspective-correct, as trackPointInto places trains). Each end cap keeps its end's value.
const WINDOW_VERTEX_DECLARE = `#ifdef TRIP_WINDOW
attribute vec2 ${WINDOW_ATTRIBUTE};
varying vec2 vWindow;
varying float vSegT;
#endif`
const WINDOW_VERTEX_MAIN = `#ifdef TRIP_WINDOW
vWindow = ${WINDOW_ATTRIBUTE};
vSegT = position.y < 0.5 ? 0.0 : 1.0;
#endif`

const DECLARE_ANCHOR = 'attribute vec3 instanceEnd;'
const START_ANCHOR = 'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );'
const END_ANCHOR = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );'

const glslFloat = (v: number) => v.toFixed(4)

/** bandShift (bandOffset.ts) in GLSL; `resolution` is LineMaterial's, in CSS pixels. */
export const BAND_GLSL = /* glsl */ `
uniform float bandPitchPx;
uniform float bandEase;
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
	float gapPx = 2.0 * trackOffsetM / metersPerPx;
	float bundlePx = 2.0 * b.w * bandPitchPx;
	float split = mix( smoothstep( ${glslFloat(TRACK_MERGE_PX)}, ${glslFloat(TRACK_SPLIT_PX)}, gapPx ), smoothstep( ${glslFloat(TRACK_MERGE_PX)} + bundlePx, ${glslFloat(TRACK_SPLIT_PX)} + bundlePx, gapPx ), bandEase );
	float s = miter * ( b.z * bandPitchPx * bandEase * metersPerPx - trackOffsetM * ( 1.0 - split ) );
	return p + vec3( n.x, 0.0, n.y ) * s;
}
`

/** Names a shader patch in replaceOnce's error: what it is, and the file to update. */
export interface PatchOwner {
  label: string
  file: string
}

const BAND_PATCH: PatchOwner = { label: 'Band shader', file: 'bandLineMaterial.ts' }

/** `src` with its one `anchor` replaced by `by`; throws, naming `owner`, if the anchor is missing or repeated (three moved it). */
export function replaceOnce(src: string, anchor: string, by: string, owner: PatchOwner = BAND_PATCH): string {
  const at = src.indexOf(anchor)
  if (at < 0 || src.indexOf(anchor, at + anchor.length) >= 0) {
    throw new Error(`${owner.label}: LineMaterial's shader no longer has exactly one "${anchor}"; update ${owner.file}`)
  }
  return src.slice(0, at) + by + src.slice(at + anchor.length)
}

/**
 * LineMaterial's vertex shader with the band offset on both segment ends and the platform fade passed on. Throws
 * if three changed the anchors.
 */
export function patchBandShader(src: string): string {
  let out = replaceOnce(src, DECLARE_ANCHOR, `${DECLARE_ANCHOR}\n${BAND_GLSL}\n${WINDOW_VERTEX_DECLARE}`)
  out = replaceOnce(out, START_ANCHOR, `vec4 start = modelViewMatrix * vec4( bandShift( instanceStart, ${BAND_START} ), 1.0 );`)
  return replaceOnce(
    out,
    END_ANCHOR,
    `vec4 end = modelViewMatrix * vec4( bandShift( instanceEnd, ${BAND_END} ), 1.0 );\n` +
      `vBandFade = 1.0 - platformFade * ( position.y < 0.5 ? ${FADE_ATTRIBUTE}.x : ${FADE_ATTRIBUTE}.y );\n` +
      WINDOW_VERTEX_MAIN,
  )
}

const FRAG_DECLARE_ANCHOR = 'uniform float opacity;'
const FRAG_COLOR_ANCHOR = 'gl_FragColor = vec4( diffuseColor.rgb, alpha );'

/**
 * The dim: a mix toward `lineDimColor` (the background, sRGB 0..1) by `lineDim`, in sRGB as mixHex does, so a dimmed
 * line is the color the theme tests measure. Never opacity. `dimLineRgb` (lineDim.ts) is its twin; change both.
 */
export const DIM_GLSL = /* glsl */ `
uniform float lineDim;
uniform vec3 lineDimColor;

vec3 dimLine( vec3 c ) {
	if ( lineDim <= 0.0 ) return c;
	vec3 s = mix( 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
	s = mix( s, lineDimColor, lineDim );
	return mix( pow( ( s + 0.055 ) / 1.055, vec3( 2.4 ) ), s / 12.92, vec3( lessThanEqual( s, vec3( 0.04045 ) ) ) );
}
`

const WINDOW_FRAGMENT_DECLARE = `#ifdef TRIP_WINDOW
varying vec2 vWindow;
varying float vSegT;
#endif`

/**
 * LineMaterial's fragment shader with the platform fade on its alpha, the dim on its color, and on a windowed layer
 * the cut outside each segment's window. Throws if three changed the anchors.
 */
export function patchBandFragment(src: string): string {
  const out = replaceOnce(src, FRAG_DECLARE_ANCHOR, `${FRAG_DECLARE_ANCHOR}\nvarying float vBandFade;\n${DIM_GLSL}\n${WINDOW_FRAGMENT_DECLARE}`)
  return replaceOnce(
    out,
    FRAG_COLOR_ANCHOR,
    '\n#ifdef TRIP_WINDOW\nif ( vSegT < vWindow.x || vSegT > vWindow.y ) discard;\n#endif\n' +
      'gl_FragColor = vec4( dimLine( diffuseColor.rgb ), alpha * vBandFade );',
  )
}

/** Sets a band layer's dim (0..1); a plain LineMaterial has none and is left alone. Per frame: never allocates or throws. */
export function writeLineDim(material: LineMaterial, dim: number): void {
  const u = material.uniforms.lineDim
  if (u) u.value = dim
}

export interface BandLineOptions {
  /** Draw only each segment's (t0, t1) window (WINDOW_ATTRIBUTE, which the geometry must then carry). */
  windowed?: boolean
  /** '#rrggbb' the dim mixes toward (useLineLayer passes theme.background); black when left out. */
  dimToward?: string
}

/**
 * Needs the two band attributes on its geometry (useLineLayer adds them). Its `lineDim` (0..1) and `lineDimColor`
 * uniforms are its own, not BAND_UNIFORMS: each layer dims by its own amount.
 */
export class BandLineMaterial extends LineMaterial {
  constructor(parameters?: LineMaterialParameters, options: BandLineOptions = {}) {
    super(parameters)
    this.vertexShader = patchBandShader(this.vertexShader)
    this.fragmentShader = patchBandFragment(this.fragmentShader)
    if (options.windowed) this.defines = { ...this.defines, TRIP_WINDOW: '' }
    Object.assign(this.uniforms, BAND_UNIFORMS)
    const [r, g, b] = options.dimToward ? srgb01(options.dimToward) : [0, 0, 0]
    // A Vector3, not a Color: a Color uniform would be taken as linear, and the mix runs in sRGB.
    this.uniforms.lineDim = { value: 0 }
    this.uniforms.lineDimColor = { value: new Vector3(r, g, b) }
  }
}
