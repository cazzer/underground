/**
 * One frame of the train follow, pure: the pan break, the camera-side lag on the train's motion, and the catch-up
 * offset that absorbs discontinuities. useTrainFollow runs it at priority -0.75 and applies the result. No allocation.
 */
import { anchorJumped, decayCatch, followTargetInto, panBroke, type FollowView } from './follow'
import { GLIDE_CONTINUE_MPS } from './live/motion'
import type { Ground } from './projection'

/**
 * Time scale of the camera's lag on the train (seconds). The lag is critically damped and tracks the train's velocity
 * as well as its position, so steady travel and stops settle exact (no trailing offset) while a lurch (a departure, a
 * catch-up glide starting or ending) is rounded off over about this long.
 */
export const FOLLOW_LAG_S = 0.35
const OMEGA = 2 / FOLLOW_LAG_S
/**
 * The fastest the lag believes a train's drawn point moves (m/s): a catch-up glide's peak (GLIDE_CONTINUE_MPS) plus a
 * train's own top speed. A faster frame-to-frame move (a live-clock offset step, a long frame) is a jump: what exceeds
 * this is taken up as position error and eased, not read as velocity that would fling the lag.
 */
export const FOLLOW_MAX_GOAL_MPS = GLIDE_CONTINUE_MPS + 30
/** Under this goal speed (m/s) the travel direction (for the no-overshoot clamp) keeps its last value. */
const DIRECTION_MIN_MPS = 0.5

/**
 * The lagged train point (ground x, z), its velocity (m/s), the goal it was last stepped toward, and the goal's last
 * direction of travel (unit; 0, 0 before it has moved).
 */
export interface FollowLag {
  x: number
  z: number
  vx: number
  vz: number
  gx: number
  gz: number
  dirX: number
  dirZ: number
}

export function createFollowLag(): FollowLag {
  return { x: 0, z: 0, vx: 0, vz: 0, gx: 0, gz: 0, dirX: 0, dirZ: 0 }
}

/** The velocity from `fromX`, `fromZ` to `toX`, `toZ` over `dt`, capped at FOLLOW_MAX_GOAL_MPS, into `out`. */
export function cappedVelocity(fromX: number, fromZ: number, toX: number, toZ: number, dt: number, out: Ground): Ground {
  out.x = (toX - fromX) / dt
  out.z = (toZ - fromZ) / dt
  const speed = Math.hypot(out.x, out.z)
  if (speed > FOLLOW_MAX_GOAL_MPS) {
    out.x *= FOLLOW_MAX_GOAL_MPS / speed
    out.z *= FOLLOW_MAX_GOAL_MPS / speed
  }
  return out
}

const vg: Ground = { x: 0, z: 0 }

/**
 * One step of the lag toward `goalX`, `goalZ`. The goal is taken to have moved at its (capped) velocity over `dt`, so
 * any move past the cap is position error. Solves the critically damped error exactly (stable at any frame time), then
 * never lets the point pass the goal along its last direction of travel: a train that stops is met, not overshot (its
 * forward velocity drops to the goal's). Under `reducedMotion` it snaps to the goal. No allocation.
 */
export function stepLag(l: FollowLag, goalX: number, goalZ: number, dt: number, reducedMotion: boolean): FollowLag {
  if (!(dt > 0)) return l
  const v = cappedVelocity(l.gx, l.gz, goalX, goalZ, dt, vg)
  const speed = Math.hypot(v.x, v.z)
  if (speed > DIRECTION_MIN_MPS) {
    l.dirX = v.x / speed
    l.dirZ = v.z / speed
  }
  if (reducedMotion) {
    l.x = goalX
    l.z = goalZ
    l.vx = v.x
    l.vz = v.z
  } else {
    const k = Math.exp(-OMEGA * dt)
    // Error from the goal's path (at goal - v·dt when the step starts): e(t) = (e0 + (ev0 + ω e0) t) e^(-ωt).
    const ex = l.x - (goalX - v.x * dt)
    const ez = l.z - (goalZ - v.z * dt)
    const evx = l.vx - v.x
    const evz = l.vz - v.z
    const ax = evx + OMEGA * ex
    const az = evz + OMEGA * ez
    l.x = goalX + (ex + ax * dt) * k
    l.z = goalZ + (ez + az * dt) * k
    l.vx = v.x + (evx - OMEGA * ax * dt) * k
    l.vz = v.z + (evz - OMEGA * az * dt) * k
    const ahead = (l.x - goalX) * l.dirX + (l.z - goalZ) * l.dirZ
    if (ahead > 0) {
      l.x -= ahead * l.dirX
      l.z -= ahead * l.dirZ
      const faster = (l.vx - v.x) * l.dirX + (l.vz - v.z) * l.dirZ
      if (faster > 0) {
        l.vx -= faster * l.dirX
        l.vz -= faster * l.dirZ
      }
    }
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
  /** The next step takes the camera's offset from the train as its catch-up (after a flight, a new follow). */
  rebase: boolean
  /** The train's point last frame (`seen` false: none) and its velocity from the last two frames, for a rebase. */
  seen: boolean
  prevX: number
  prevZ: number
  trainV: Ground
}

export function createFollowState(): FollowState {
  return {
    lag: createFollowLag(),
    aim: { x: 0, y: 0, z: 0 },
    desired: { x: 0, z: 0 },
    catchUp: { x: 0, z: 0 },
    last: { x: 0, z: 0 },
    baselined: false,
    panPx: 0,
    rebase: true,
    seen: false,
    prevX: 0,
    prevZ: 0,
    trainV: { x: 0, z: 0 },
  }
}

/**
 * Records the train's point for this frame (null: none), keeping its velocity from the last two frames. Called by
 * stepFollow, and by the hook on flight frames, so the lag starts at the train's speed when a flight lands. A cut keeps
 * the last velocity (the jump isn't travel).
 */
export function observeTrain(s: FollowState, p: Ground | null, dt: number, cut: boolean): void {
  if (!p) {
    s.seen = false
    return
  }
  if (s.seen && !cut && dt > 0) cappedVelocity(s.prevX, s.prevZ, p.x, p.z, dt, s.trainV)
  s.seen = true
  s.prevX = p.x
  s.prevZ = p.z
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
 * train point steps toward the train (a rebase or a cut moves it with the train instead, keeping its velocity, or at
 * the train's last measured velocity after a rebase), and the target is the one that puts that point mid-free in this frame's view: exact for any
 * zoom or turn. On a rebase, a cut or a free change the camera's offset from it becomes the catch-up, easing out; a
 * cut bigger than the jump threshold on screen asks for a flight instead.
 */
export function stepFollow(s: FollowState, i: FollowStepInput, out: Ground): FollowStepResult {
  const t = i.target
  if (s.baselined) s.panPx += Math.hypot(t.x - s.last.x, t.z - s.last.z) / i.metersPerPx
  s.baselined = true
  s.last.x = out.x = t.x
  s.last.z = out.z = t.z
  const p = i.train
  observeTrain(s, p, i.dt, i.cut)
  if (panBroke(s.panPx, i.touch)) return 'break'
  if (!p) {
    s.rebase = true
    return 'hold'
  }
  const l = s.lag
  const k = s.catchUp
  const jump = s.rebase || i.cut
  if (jump) {
    if (s.rebase) {
      // Start at the train's own speed, so a landing flight hands over without a hitch.
      l.vx = s.trainV.x
      l.vz = s.trainV.z
    }
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
