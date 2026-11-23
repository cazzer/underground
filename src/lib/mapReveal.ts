import type { ScreenRect } from './interiorCamera'

/** The opening wipe's length. */
export const REVEAL_MS = 1000
/** The soft edge's width, as a share of the wipe's final radius. */
export const REVEAL_FEATHER_SHARE = 0.18
/** The reduced-motion fade's length. */
export const REVEAL_FADE_MS = 200

/** The longest frame a clock step counts, so a stalled frame slows the wipe instead of jumping it. */
export const REVEAL_MAX_STEP_MS = 34

/** Where the wipe starts and how far it must travel, in CSS px of the cover. */
export interface RevealGeometry {
  cx: number
  cy: number
  /** Distance from the centre to the farthest corner. */
  radius: number
  feather: number
}

/** The wipe's edge: clear inside `inner`, fully covered beyond `outer` (CSS px from the centre). */
export interface RevealFront {
  inner: number
  outer: number
}

/** Ease-out cubic, clamped to 0..1. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - (1 - c) ** 3
}

/** Linear progress 0..1; a zero or negative duration is already done. */
export function revealProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1
  return Math.min(1, Math.max(0, elapsedMs / durationMs))
}

/**
 * The wipe's centre (the middle of `free`, the part of the viewport the HUD bands and panel leave
 * open) and its radius: the distance to the farthest corner of the width x height viewport.
 */
export function revealGeometry(width: number, height: number, free: ScreenRect): RevealGeometry {
  const cx = (free.left + free.right) / 2
  const cy = free.top + Math.max(0, free.bottom - free.top) / 2
  const radius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy))
  return { cx, cy, radius, feather: REVEAL_FEATHER_SHARE * radius }
}

/** The clock after a frame at `nowMs`, the last one at `lastMs`: each step counts at most `REVEAL_MAX_STEP_MS`. */
export function advanceClock(accMs: number, lastMs: number, nowMs: number): number {
  return accMs + Math.min(Math.max(nowMs - lastMs, 0), REVEAL_MAX_STEP_MS)
}

/** The edge at `progress` (0..1): the outer edge runs past the radius so the inner one clears every corner. */
export function revealFront(g: RevealGeometry, progress: number): RevealFront {
  const outer = easeOutCubic(progress) * (g.radius + g.feather)
  return { inner: Math.max(0, outer - g.feather), outer }
}

/** The cover's CSS background for a front: transparent inside, `cover` beyond. */
export function revealGradient(g: RevealGeometry, f: RevealFront, cover: string): string {
  return `radial-gradient(circle at ${g.cx}px ${g.cy}px, transparent ${f.inner}px, ${cover} ${f.outer}px)`
}

/** The reduced-motion cover's opacity: 1 falling linearly to 0 over `REVEAL_FADE_MS`. */
export function fadeOpacity(elapsedMs: number): number {
  return 1 - revealProgress(elapsedMs, REVEAL_FADE_MS)
}
