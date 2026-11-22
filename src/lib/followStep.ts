/**
 * One frame of the train follow, pure: the pan break, the camera-side lag on the train's motion, and the catch-up
 * offset that absorbs discontinuities. useTrainFollow runs it at priority -0.75 and applies the result. No allocation.
 */
import { anchorJumped, decayCatch, followTargetInto, panBroke, type FollowView } from './follow'
import type { Ground } from './projection'

/**
 * Time scale of the camera's lag on the train (seconds). The lag is critically damped and tracks the train's velocity
 * as well as its position, so steady travel and stops settle exact (no trailing offset) while a lurch (a departure, a
 * catch-up glide starting or ending) is rounded off over about this long.
 */
export const FOLLOW_LAG_S = 0.35
const OMEGA = 2 / FOLLOW_LAG_S

/** The lagged train point (ground x, z), its velocity (m/s) and the goal it was last stepped toward. */
export interface FollowLag {
  x: number
  z: number
  vx: number
  vz: number
  gx: number
  gz: number
}

/**
 * One step of the lag toward `goalX`, `goalZ`, which moved there from the last goal at a steady velocity over `dt`.
 * Solves the critically damped error exactly (stable at any frame time). Under `reducedMotion` it snaps to the goal.
 */
export function stepLag(l: FollowLag, goalX: number, goalZ: number, dt: number, reducedMotion: boolean): FollowLag {
  if (!(dt > 0)) return l
  const vgx = (goalX - l.gx) / dt
  const vgz = (goalZ - l.gz) / dt
  if (reducedMotion) {
    l.x = goalX
    l.z = goalZ
    l.vx = vgx
    l.vz = vgz
  } else {
    const k = Math.exp(-OMEGA * dt)
    // Error from the goal (moving at vg over the step): e(t) = (e0 + (ev0 + ω e0) t) e^(-ωt).
    const ex = l.x - l.gx
    const ez = l.z - l.gz
    const evx = l.vx - vgx
    const evz = l.vz - vgz
    const ax = evx + OMEGA * ex
    const az = evz + OMEGA * ez
    l.x = goalX + (ex + ax * dt) * k
    l.z = goalZ + (ez + az * dt) * k
    l.vx = vgx + (evx - OMEGA * ax * dt) * k
    l.vz = vgz + (evz - OMEGA * az * dt) * k
  }
  l.gx = goalX
  l.gz = goalZ
  return l
}

/** What the follow carries from frame to frame. */
export interface FollowState {
  /** The train's point as the camera follows it: lagged on the train's own motion only, never on the camera's. */
  lag: FollowLag
  /** The lagged point with the train's height, for followTargetInto. */
  aim: { x: number; y: number; z: number }
  /** The target that puts the lagged point mid-free this frame. */
  desired: Ground
  /** The camera's offset from the lagged point, easing out (decayCatch). */
  catchUp: Ground
  /** Where the target was left last frame, or at the gesture start; the controls' pan moves it from there. */
  last: Ground
  /** False until `last` is set (after a flight, or a follow just started): that frame's move isn't counted as a pan. */
  baselined: boolean
  /** The pan summed over the current gesture, CSS px. */
  panPx: number
  /** The next step takes the camera's offset from the train as its catch-up, from rest (after a flight, a new follow). */
  rebase: boolean
}

export function createFollowState(): FollowState {
  return {
    lag: { x: 0, z: 0, vx: 0, vz: 0, gx: 0, gz: 0 },
    aim: { x: 0, y: 0, z: 0 },
    desired: { x: 0, z: 0 },
    catchUp: { x: 0, z: 0 },
    last: { x: 0, z: 0 },
    baselined: false,
    panPx: 0,
    rebase: true,
  }
}

export interface FollowStepInput {
  /** The controls' target now, after their update(). */
  target: Ground
  /** The train's drawn point (FollowAnchor), or null when there is no train to follow. */
  train: { x: number; y: number; z: number } | null
  /** This frame's camera pose and free-area centre (writeFollowView). */
  view: FollowView
  metersPerPx: number
  dt: number
  /** The anchor moved discontinuously this frame (FollowAnchor.cut). */
  cut: boolean
  /** The free area changed since the last step. */
  freeChanged: boolean
  /** The current gesture is a touch (the larger pan break). */
  touch: boolean
  reducedMotion: boolean
}

/** move: put the target at `out` (camera by the same step). hold: leave it. break: end the follow. refly: fly to `out`. */
export type FollowStepResult = 'move' | 'hold' | 'break' | 'refly'

/**
 * One frame. Only the controls' pan moves the target between steps (zoom is about it while following, a turn keeps
 * it), so the move since `last` is the pan; the step's own write becomes the new `last` and never counts. The lagged
 * train point steps toward the train (a rebase or a cut moves it with the train instead, keeping its velocity, or from
 * rest after a rebase), and the target is the one that puts that point mid-free in this frame's view: exact for any
 * zoom or turn. On a rebase, a cut or a free change the camera's offset from it becomes the catch-up, easing out; a
 * cut bigger than the jump threshold on screen asks for a flight instead.
 */
export function stepFollow(s: FollowState, i: FollowStepInput, out: Ground): FollowStepResult {
  const t = i.target
  if (s.baselined) s.panPx += Math.hypot(t.x - s.last.x, t.z - s.last.z) / i.metersPerPx
  s.baselined = true
  s.last.x = out.x = t.x
  s.last.z = out.z = t.z
  if (panBroke(s.panPx, i.touch)) return 'break'
  const p = i.train
  if (!p) {
    s.rebase = true
    return 'hold'
  }
  const l = s.lag
  const k = s.catchUp
  const jump = s.rebase || i.cut
  if (jump) {
    if (s.rebase) l.vx = l.vz = 0
    // The lagged point jumps with the train and keeps its velocity.
    l.x = l.gx = p.x - l.vx * i.dt
    l.z = l.gz = p.z - l.vz * i.dt
  }
  stepLag(l, p.x, p.z, i.dt, i.reducedMotion)
  s.aim.x = l.x
  s.aim.y = p.y
  s.aim.z = l.z
  const d = followTargetInto(s.aim, i.view, s.desired)
  if (jump || i.freeChanged) {
    if (i.cut && !s.rebase && anchorJumped(Math.hypot(t.x - d.x, t.z - d.z), i.metersPerPx)) {
      s.rebase = true
      out.x = d.x
      out.z = d.z
      return 'refly'
    }
    // The camera's offset becomes the catch-up.
    k.x = t.x - d.x
    k.z = t.z - d.z
    s.rebase = false
  }
  decayCatch(k, i.dt, i.reducedMotion)
  out.x = s.last.x = d.x + k.x
  out.z = s.last.z = d.z + k.z
  return 'move'
}
