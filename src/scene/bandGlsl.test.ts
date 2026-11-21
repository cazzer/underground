/**
 * Drift guard between BAND_GLSL and bandShift (bandOffset.ts): the GLSL's statements are pinned below, and a
 * statement-for-statement JS port of them must agree with bandShift over random views. Changing either side
 * without the other fails here.
 */
import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { bandShift, createBandView, MIN_FORESHORTEN, TRACK_MERGE_PX, TRACK_SPLIT_PX, writeBandView } from '../lib/bandOffset'
import { BAND_GLSL } from './bandLineMaterial'

const f = (v: number) => v.toFixed(4)
/** BAND_GLSL's function body, one statement per line, as the port below follows it. */
const PINNED = `
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
	float metersPerPx = k * w * length( ts ) / max( cross2, ${f(MIN_FORESHORTEN)} );
	float gapPx = 2.0 * trackOffsetM / metersPerPx;
	float bundlePx = 2.0 * b.w * bandPitchPx;
	float split = mix( smoothstep( ${f(TRACK_MERGE_PX)}, ${f(TRACK_SPLIT_PX)}, gapPx ), smoothstep( ${f(TRACK_MERGE_PX)} + bundlePx, ${f(TRACK_SPLIT_PX)} + bundlePx, gapPx ), bandEase );
	float s = miter * ( b.z * bandPitchPx * bandEase * metersPerPx - trackOffsetM * ( 1.0 - split ) );
	return p + vec3( n.x, 0.0, n.y ) * s;
`

const squash = (src: string) => src.replace(/\s+/g, ' ').trim()

interface GlslInputs {
  modelView: Matrix4
  projection: Matrix4
  resolutionY: number
  bandPitchPx: number
  bandEase: number
  trackOffsetM: number
}

const glslSmoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** The pinned GLSL, statement for statement (GLSL matrices are column-major: m[c][r] = elements[c * 4 + r]). */
function glslBandShift(u: GlslInputs, p: Vector3, b: [number, number, number, number]): Vector3 {
  const miter = Math.hypot(b[0], b[1])
  if (miter === 0) return p.clone()
  const n: [number, number] = [b[0] / miter, b[1] / miter]
  const pv = p.clone().applyMatrix4(u.modelView)
  const w = Math.max(-pv.z, 1e-3)
  const q: [number, number] = [pv.x / w, pv.y / w]
  const nv = new Vector3(n[0], 0, n[1]).transformDirection(u.modelView)
  const tv = new Vector3(n[1], 0, -n[0]).transformDirection(u.modelView)
  const ns = [nv.x + q[0]! * nv.z, nv.y + q[1]! * nv.z]
  const ts = [tv.x + q[0]! * tv.z, tv.y + q[1]! * tv.z]
  const cross2 = Math.abs(ts[0]! * ns[1]! - ts[1]! * ns[0]!)
  const k = 2 / (u.projection.elements[1 * 4 + 1]! * u.resolutionY)
  const metersPerPx = (k * w * Math.hypot(ts[0]!, ts[1]!)) / Math.max(cross2, MIN_FORESHORTEN)
  const gapPx = (2 * u.trackOffsetM) / metersPerPx
  const bundlePx = 2 * b[3] * u.bandPitchPx
  const mix = (x: number, y: number, a: number) => x * (1 - a) + y * a
  const split = mix(glslSmoothstep(TRACK_MERGE_PX, TRACK_SPLIT_PX, gapPx), glslSmoothstep(TRACK_MERGE_PX + bundlePx, TRACK_SPLIT_PX + bundlePx, gapPx), u.bandEase)
  const s = miter * (b[2] * u.bandPitchPx * u.bandEase * metersPerPx - u.trackOffsetM * (1 - split))
  return p.clone().add(new Vector3(n[0], 0, n[1]).multiplyScalar(s))
}

/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('BAND_GLSL', () => {
  it('is the pinned statement list', () => {
    const body = BAND_GLSL.slice(BAND_GLSL.indexOf('vec3 bandShift( vec3 p, vec4 b ) {') + 'vec3 bandShift( vec3 p, vec4 b ) {'.length, BAND_GLSL.lastIndexOf('}'))
    expect(squash(body)).toBe(squash(PINNED))
  })

  it('agrees with bandShift over random views, points, miters, slots and half-widths', () => {
    // Normalized, so a rotation-only modelViewMatrix (an identity world matrix, as the route lines have) is assumed.
    const rand = random(7)
    for (let trial = 0; trial < 300; trial++) {
      const height = 400 + rand() * 800
      const cam = new PerspectiveCamera(35, (300 + rand() * 1200) / height, 10, 1e6)
      const target = new Vector3((rand() - 0.5) * 40_000, 0, (rand() - 0.5) * 40_000)
      const distance = 150 * Math.pow(400, rand())
      const polar = rand() * 0.96
      const azimuth = (rand() - 0.5) * 2 * Math.PI
      cam.position.set(
        target.x + distance * Math.sin(polar) * Math.sin(azimuth),
        distance * Math.cos(polar),
        target.z + distance * Math.sin(polar) * Math.cos(azimuth),
      )
      cam.up.set(0, 1, 0)
      if (polar < 1e-3) cam.up.set(0, 0, -1)
      cam.lookAt(target)
      cam.updateMatrixWorld()
      // Half the trials mid ease-in.
      const ease = trial % 2 === 0 ? 1 : rand()
      const view = writeBandView(createBandView(), cam.matrixWorldInverse.elements, cam.projectionMatrix.elements[5]!, height, distance, 2.5, 4.7, ease)
      const heading = rand() * 2 * Math.PI
      const miter = 1 + rand()
      const b: [number, number, number, number] = [Math.cos(heading) * miter, Math.sin(heading) * miter, Math.round((rand() - 0.5) * 12) / 2, Math.round(rand() * 6) / 2]
      const p = target.clone().add(new Vector3((rand() - 0.5) * distance * 0.3, -rand() * 20, (rand() - 0.5) * distance * 0.3))
      const glsl = glslBandShift(
        { modelView: cam.matrixWorldInverse, projection: cam.projectionMatrix, resolutionY: height, bandPitchPx: view.pitchPx, bandEase: ease, trackOffsetM: 4.7 },
        p,
        b,
      )
      const s = bandShift(view, p.x, p.y, p.z, b[0], b[1], b[2], b[3])
      const ts = new Vector3(b[0] / miter, 0, b[1] / miter).multiplyScalar(s).add(p)
      expect(glsl.distanceTo(ts)).toBeLessThan(1e-6 * Math.max(1, Math.abs(s)))
    }
  })
})
