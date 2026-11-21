/**
 * The band offset: how far a point on a route's track moves sideways so routes sharing a corridor draw as
 * adjacent bands a fixed number of screen pixels apart at any zoom and tilt. Its GLSL twin is BAND_GLSL in
 * src/scene/bandLineMaterial.ts, which moves the map lines on the GPU; this TS copy is for anything drawn or
 * picked on the CPU along the same lines (trains, in 10b). Change both together (bandLineMaterial.test.ts runs
 * a line-by-line port of the GLSL against this). Pure, no allocation per call.
 *
 * The GLSL transforms by modelViewMatrix and this by the camera's view matrix: they agree because the route
 * lines' object sits at the origin with no rotation or scale (an identity world matrix).
 *
 * For a point p (view space, depth w = -p.z) on a track whose miter normal is n and tangent t (ground), the
 * screen images of t and n are J t and J n, with J v = (v.xy + (p.xy / w) v.z) / w (perspective's Jacobian, in
 * tan units; one pixel is k = 2 / (P11 * heightPx) of them). Parallel lines L meters apart along n sit
 * L |J t × J n| / (|J t| k) pixels apart, so one pixel across the track is
 *   m = k * w * |t'| / max(|t' × n'|, MIN_FORESHORTEN) meters   (t', n' = J t, J n without the 1/w)
 * which is the plan's k * depth * |M T| / max(cos polar, 0.25) with the perspective terms kept. A slot moves
 * band * pitchPx * m. The two direction tracks (2 * trackOffsetM apart, gapPx = 2 * trackOffsetM / m on screen)
 * draw on one line until both bundles fit side by side: the split eases in from MERGE_PX + 2 * half * pitchPx
 * to SPLIT_PX + 2 * half * pitchPx, with `half` the corridor's half-width in slots. Merged, the point moves back
 * to the centerline by trackOffsetM * (1 - split). Both shifts follow the miter, so joins stay joined.
 */

export interface BandView {
  /** World-to-view matrix, column-major (three's Matrix4.elements of camera.matrixWorldInverse). */
  readonly view: Float64Array
  /** Tan units per CSS pixel: 2 / (P11 * heightPx). */
  k: number
  /** Gap between neighbouring bands, CSS pixels (0 at the overview). */
  pitchPx: number
  trackOffsetM: number
}

/** The band pitch fades from full at FADE_NEAR_M to 0 at FADE_FAR_M of camera distance (the city overview). */
export const BAND_FADE_NEAR_M = 25_000
export const BAND_FADE_FAR_M = 80_000
/** A single route's direction tracks closer than MERGE_PX on screen draw as one; apart from SPLIT_PX (a short ramp, so bundles don't slide through each other for long). */
export const TRACK_MERGE_PX = 6.5
export const TRACK_SPLIT_PX = 8.5
/** Floor of the foreshortening divisor, so a grazing view can't blow the shift up. */
export const MIN_FORESHORTEN = 0.25

export function createBandView(): BandView {
  return { view: new Float64Array(16), k: 0, pitchPx: 0, trackOffsetM: 0 }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** Band pitch in pixels at a camera distance: `pitchPx` up close, eased to 0 across the overview fade. */
export function bandPitchAt(distance: number, pitchPx: number): number {
  return pitchPx * smoothstep(BAND_FADE_FAR_M, BAND_FADE_NEAR_M, distance)
}

/** 0: the direction tracks drawn on one line; 1: apart. `bundlePx` is the width of one bundle's bands (2 * half * pitch). */
export function trackSplit(gapPx: number, bundlePx: number): number {
  return smoothstep(TRACK_MERGE_PX + bundlePx, TRACK_SPLIT_PX + bundlePx, gapPx)
}

/**
 * The frame's view, into `out`. `viewElements` is camera.matrixWorldInverse.elements after
 * camera.updateMatrixWorld(), `p11` is camera.projectionMatrix.elements[5], `heightPx` the canvas CSS height and
 * `distance` the camera's distance to its target.
 */
export function writeBandView(
  out: BandView,
  viewElements: ArrayLike<number>,
  p11: number,
  heightPx: number,
  distance: number,
  pitchPx: number,
  trackOffsetM: number,
): BandView {
  for (let i = 0; i < 16; i++) out.view[i] = viewElements[i]!
  out.k = 2 / (p11 * heightPx)
  out.pitchPx = bandPitchAt(distance, pitchPx)
  out.trackOffsetM = trackOffsetM
  return out
}

/**
 * Meters to move the track point (x, y, z) along its unit miter normal: the drawn point is
 * (x + mx / |m| * s, y, z + mz / |m| * s). (mx, mz) is the miter normal scaled by the join's length factor
 * (1 / cosHalf, trackOffset.ts), `band` the point's slot and `half` its corridor's half-width (corridors.ts),
 * as in LineBuffers.bands.
 */
export function bandShift(v: BandView, x: number, y: number, z: number, mx: number, mz: number, band: number, half: number): number {
  const miter = Math.hypot(mx, mz)
  if (miter === 0) return 0
  const nx = mx / miter
  const nz = mz / miter
  const e = v.view
  const w = Math.max(-(e[2]! * x + e[6]! * y + e[10]! * z + e[14]!), 1e-3)
  const qx = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w
  const qy = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w
  // n' and t' (t = (nz, -nx), so n is t's right normal), without the common 1 / w.
  const nsx = e[0]! * nx + e[8]! * nz + qx * (e[2]! * nx + e[10]! * nz)
  const nsy = e[1]! * nx + e[9]! * nz + qy * (e[2]! * nx + e[10]! * nz)
  const tsx = e[0]! * nz - e[8]! * nx + qx * (e[2]! * nz - e[10]! * nx)
  const tsy = e[1]! * nz - e[9]! * nx + qy * (e[2]! * nz - e[10]! * nx)
  const cross = Math.abs(tsx * nsy - tsy * nsx)
  const metersPerPx = (v.k * w * Math.hypot(tsx, tsy)) / Math.max(cross, MIN_FORESHORTEN)
  // A view not written yet (all zeros) has no scale: nothing moves. Never the case on the GPU.
  if (!(metersPerPx > 0)) return 0
  const split = trackSplit((2 * v.trackOffsetM) / metersPerPx, 2 * half * v.pitchPx)
  return miter * (band * v.pitchPx * metersPerPx - v.trackOffsetM * (1 - split))
}
