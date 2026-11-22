import { describe, expect, it } from 'vitest'
import { createFollowView, FOLLOW_BREAK_PX, FOLLOW_JUMP_PX, followTargetInto, metersPerPx, writeFollowView, type FollowView } from './follow'
import {
  cappedVelocity,
  createFollowLag,
  createFollowState,
  FOLLOW_LAG_S,
  FOLLOW_MAX_GOAL_MPS,
  observeTrain,
  stepFollow,
  stepLag,
  type FollowState,
  type FollowStepInput,
} from './followStep'
import type { Ground } from './projection'
import { ISO_POLAR } from './tilt'

const DT = 1 / 60
const MPP = 0.3

const VIEWPORT = { width: 390, height: 844 }
/** Top-down with the free area centred: the target for a train is its own ground point. */
const FLAT: FollowView = writeFollowView(createFollowView(), VIEWPORT, { left: 0, top: 0, right: 390, bottom: 844 }, 35, 400, 0, 0)

function input(target: Ground, train: Ground | null, over: Partial<FollowStepInput> = {}): FollowStepInput {
  const p = train && { x: train.x, y: 0, z: train.z }
  return { target, train: p, view: FLAT, metersPerPx: MPP, dt: DT, cut: false, freeChanged: false, touch: false, reducedMotion: false, ...over }
}

/** Runs the follow for `frames` frames with the train at `train(n)`, applying each move to the target like the hook. */
function run(s: FollowState, target: Ground, frames: number, train: (n: number) => Ground, over: (n: number) => Partial<FollowStepInput> = () => ({})) {
  const out = { x: 0, z: 0 }
  let last = ''
  for (let n = 0; n < frames; n++) {
    last = stepFollow(s, input(target, train(n), over(n)), out)
    if (last === 'move') {
      target.x = out.x
      target.z = out.z
    }
    if (last !== 'move' && last !== 'hold') break
  }
  return last
}

describe('stepLag', () => {
  it('tracks steady motion with no trailing offset, and holds a stop exactly', () => {
    const l = createFollowLag()
    for (let n = 1; n <= 120; n++) stepLag(l, 15 * n * DT, 0, DT, false)
    expect(Math.abs(l.x - 15 * 120 * DT)).toBeLessThan(0.3 * MPP)
    for (let n = 1; n <= 60; n++) stepLag(l, 30, 0, DT, false)
    expect(Math.abs(l.x - 30)).toBeLessThan(0.3 * MPP)
  })

  it('rounds off a departure: a few px behind at most, settled within a second', () => {
    const l = createFollowLag()
    let worst = 0
    for (let n = 1; n <= 60; n++) {
      stepLag(l, 15 * n * DT, 0, DT, false)
      worst = Math.max(worst, Math.abs(l.x - 15 * n * DT))
    }
    expect(worst).toBeGreaterThan(0.5)
    expect(worst / MPP).toBeLessThan(5)
    expect(Math.abs(l.x - 15) / MPP).toBeLessThan(1)
  })

  it('meets a train that stops dead instead of overshooting it', () => {
    // 15 m/s for 3 s, then stopped: no more than 0.5 px past the stop on a phone at 400 m.
    const px = metersPerPx(400, 35, 844)
    const l = createFollowLag()
    const stopAt = 15 * 180 * DT
    let ahead = -Infinity
    for (let n = 1; n <= 300; n++) {
      const goal = Math.min(15 * n * DT, stopAt)
      stepLag(l, 0, -goal, DT, false)
      if (n > 180) ahead = Math.max(ahead, (stopAt - -l.z) * -1)
    }
    expect(ahead / px).toBeLessThanOrEqual(0.5)
    expect(Math.abs(-l.z - stopAt) / px).toBeLessThan(0.5)
    expect(Math.hypot(l.vx, l.vz)).toBeLessThan(0.5)
  })

  it('caps the goal velocity: a 7 m jump in one frame is eased, not flung', () => {
    expect(Math.hypot(...Object.values(cappedVelocity(0, 0, 7, 0, DT, { x: 0, z: 0 })))).toBeCloseTo(FOLLOW_MAX_GOAL_MPS)
    expect(cappedVelocity(0, 0, 0.2, 0, DT, { x: 0, z: 0 }).x).toBeCloseTo(12)
    const l = createFollowLag()
    let maxV = 0
    let maxX = 0
    stepLag(l, 7, 0, DT, false)
    for (let n = 0; n < 120; n++) {
      maxV = Math.max(maxV, Math.hypot(l.vx, l.vz))
      maxX = Math.max(maxX, l.x)
      stepLag(l, 7, 0, DT, false)
    }
    expect(maxV).toBeLessThan(FOLLOW_MAX_GOAL_MPS)
    expect(maxX).toBeLessThanOrEqual(7 + 1e-9)
    expect(Math.abs(l.x - 7)).toBeLessThan(0.05)
  })

  it('is stable at a long frame and snaps under reduced motion', () => {
    const l = createFollowLag()
    stepLag(l, 100, 0, 2, false)
    expect(Math.abs(l.x - 100)).toBeLessThan(100)
    stepLag(l, 120, 0, DT, true)
    expect(l.x).toBe(120)
    expect(FOLLOW_LAG_S).toBeCloseTo(0.35)
  })
})

describe('stepFollow', () => {
  it('lands exact on a steadily moving train', () => {
    const s = createFollowState()
    const target = { x: 0, z: 0 }
    run(s, target, 120, (n) => ({ x: 20 * n * DT, z: -5 * n * DT }))
    expect(Math.hypot(target.x - 20 * 119 * DT, target.z + 5 * 119 * DT) / MPP).toBeLessThan(1)
    expect(s.panPx).toBe(0)
  })

  it("never counts its own writes as a pan", () => {
    const s = createFollowState()
    const target = { x: 500, z: 500 }
    expect(run(s, target, 300, (n) => ({ x: 40 * n * DT, z: 0 }))).toBe('move')
    expect(s.panPx).toBe(0)
  })

  it('eases a free change in rather than jumping', () => {
    const s = createFollowState()
    const target = { x: 0, z: 0 }
    run(s, target, 30, () => ({ x: 0, z: 0 }))
    // The panel grew: the free centre moves 100 px up, so the train's target moves 30 m.
    const raised = writeFollowView(createFollowView(), VIEWPORT, { left: 0, top: 0, right: 390, bottom: 644 }, 35, 400, 0, 0)
    const want = followTargetInto({ x: 0, y: 0, z: 0 }, raised, { x: 0, z: 0 })
    expect(Math.abs(want.z) / MPP).toBeGreaterThan(90)
    const out = { x: 0, z: 0 }
    stepFollow(s, input(target, { x: 0, z: 0 }, { view: raised, freeChanged: true }), out)
    expect(Math.abs(out.z)).toBeLessThan(Math.abs(want.z) * 0.1)
    target.z = out.z
    run(s, target, 90, () => ({ x: 0, z: 0 }), () => ({ view: raised }))
    expect(Math.abs(target.z - want.z) / MPP).toBeLessThan(1)
  })

  it('re-flies over a cut bigger than the jump threshold, and eases a smaller one', () => {
    const s = createFollowState()
    const target = { x: 0, z: 0 }
    run(s, target, 10, () => ({ x: 0, z: 0 }))
    const out = { x: 0, z: 0 }
    const far = (FOLLOW_JUMP_PX + 5) * MPP
    expect(stepFollow(s, input(target, { x: far, z: 0 }, { cut: true }), out)).toBe('refly')
    expect(out.x).toBe(far)
    const t = createFollowState()
    const target2 = { x: 0, z: 0 }
    run(t, target2, 10, () => ({ x: 0, z: 0 }))
    expect(stepFollow(t, input(target2, { x: far / 2, z: 0 }, { cut: true }), out)).toBe('move')
    expect(out.x).toBeLessThan(far / 4)
  })

  it('breaks on a pan of the threshold in one gesture, not on smaller ones', () => {
    const s = createFollowState()
    const target = { x: 0, z: 0 }
    run(s, target, 5, () => ({ x: 0, z: 0 }))
    // The controls pan the target between steps; the follow puts it back.
    target.x += (FOLLOW_BREAK_PX - 2) * MPP
    expect(run(s, target, 1, () => ({ x: 0, z: 0 }))).toBe('move')
    target.x += 3 * MPP
    expect(run(s, target, 1, () => ({ x: 0, z: 0 }))).toBe('break')
  })

  it('takes a larger pan to break on touch', () => {
    const s = createFollowState()
    const target = { x: 0, z: 0 }
    run(s, target, 5, () => ({ x: 0, z: 0 }))
    target.x += (FOLLOW_BREAK_PX + 2) * MPP
    expect(run(s, target, 1, () => ({ x: 0, z: 0 }), () => ({ touch: true }))).toBe('move')
  })

  it('keeps a stopped train exactly centred through a turn: the lag smooths the train, not the camera', () => {
    const s = createFollowState()
    const target = { x: 0, z: 0 }
    const train = { x: 100, z: -40 }
    const free = { left: 0, top: 120, right: 390, bottom: 380 }
    const view = (az: number) => writeFollowView(createFollowView(), VIEWPORT, free, 35, 400, ISO_POLAR, az)
    run(s, target, 120, () => train, () => ({ view: view(0) }))
    const want = { x: 0, z: 0 }
    for (let n = 1; n <= 60; n++) {
      const v = view(n * 0.05)
      run(s, target, 1, () => train, () => ({ view: v }))
      followTargetInto({ ...train, y: 0 }, v, want)
      expect(Math.hypot(target.x - want.x, target.z - want.z)).toBeLessThan(1e-6)
    }
  })

  it('starts at the train\'s own speed after a rebase (a landing flight), with no hitch', () => {
    const s = createFollowState()
    // Flight frames: the hook observes the train while the flight owns the camera.
    for (let n = 0; n < 10; n++) observeTrain(s, { x: 0, z: -15 * n * DT }, DT, false)
    expect(s.trainV.z).toBeCloseTo(-15)
    // The flight landed on the train: the target is where it puts the train mid-free.
    const target = { x: 0, z: -15 * 10 * DT }
    let worst = 0
    for (let n = 0; n < 60; n++) {
      run(s, target, 1, () => ({ x: 0, z: -15 * (10 + n) * DT }))
      worst = Math.max(worst, Math.abs(target.z + 15 * (10 + n) * DT))
    }
    expect(worst / MPP).toBeLessThan(0.1)
    const fresh = createFollowState()
    const t2 = { x: 0, z: 0 }
    let worstUnseeded = 0
    for (let n = 0; n < 60; n++) {
      run(fresh, t2, 1, () => ({ x: 0, z: -15 * n * DT }))
      if (n > 1) worstUnseeded = Math.max(worstUnseeded, Math.abs(t2.z + 15 * n * DT))
    }
    expect(worstUnseeded).toBeGreaterThan(0.3)
  })

  it('holds without a train, then eases onto it', () => {
    const s = createFollowState()
    const target = { x: 0, z: 0 }
    const out = { x: 0, z: 0 }
    expect(stepFollow(s, input(target, null), out)).toBe('hold')
    expect(out).toEqual({ x: 0, z: 0 })
    run(s, target, 120, () => ({ x: 50, z: 0 }))
    expect(Math.abs(target.x - 50)).toBeLessThan(0.1)
  })
})
