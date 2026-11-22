import { describe, expect, it } from 'vitest'
import { clampAzimuth, createTouchOrbit, takeTurn, touchDown, touchMove, touchReset, touchUp, wrapAngle, type TouchOrbit } from './touchOrbit'

const H = 844
const DEG = Math.PI / 180
const C = { x: 195, y: 422 }

type Pair = [[number, number], [number, number]]
const at = (cx: number, cy: number, r: number, angle: number): Pair => [
  [cx - r * Math.cos(angle), cy - r * Math.sin(angle)],
  [cx + r * Math.cos(angle), cy + r * Math.sin(angle)],
]

/** Puts two fingers down at path(0) and moves them along path in `steps`, taking the turn after each move. */
function gesture(path: (u: number) => Pair, armed = true, steps = 30, t: TouchOrbit = createTouchOrbit()) {
  const p0 = path(0)
  touchDown(t, 1, p0[0][0], p0[0][1])
  touchDown(t, 2, p0[1][0], p0[1][1])
  let turn = 0
  for (let i = 1; i <= steps; i++) {
    const p = path(i / steps)
    touchMove(t, 1, p[0][0], p[0][1], armed)
    turn += takeTurn(t, H)
    touchMove(t, 2, p[1][0], p[1][1], armed)
    turn += takeTurn(t, H)
  }
  return { t, turn }
}

describe('touchOrbit', () => {
  it('turns a 60° clockwise twist by about +60°', () => {
    const { t, turn } = gesture((u) => at(C.x, C.y, 75, u * 60 * DEG))
    expect(t.lock).toBe('rotate')
    expect(turn / DEG).toBeCloseTo(60, 6)
  })

  it('locks a pinch with modest drift to zoom and never turns it', () => {
    for (const drift of [20, 30]) {
      const { t, turn } = gesture((u) => at(C.x + drift * u, C.y, 75 + 50 * u, 0))
      expect(t.lock).toBe('zoom')
      expect(turn).toBe(0)
    }
  })

  it('turns a 100 px two-finger slide as the controls did: -2π · dx / height', () => {
    const { t, turn } = gesture((u) => at(C.x + 100 * u, C.y, 75, 0))
    expect(t.lock).toBe('rotate')
    expect(turn / DEG).toBeCloseTo(-42.65, 1)
  })

  it('still turns a twist that also spreads a little', () => {
    const { t, turn } = gesture((u) => at(C.x, C.y, 75 + 7.5 * u, u * 60 * DEG))
    expect(t.lock).toBe('rotate')
    expect(turn / DEG).toBeCloseTo(60, 6)
  })

  it('never rotates when turning is not armed, and zoom still locks', () => {
    const twist = gesture((u) => at(C.x, C.y, 75, u * 60 * DEG), false)
    expect(twist.t.lock).toBe('pending')
    expect(twist.turn).toBe(0)
    const pinch = gesture((u) => at(C.x, C.y, 75 + 50 * u, u * 20 * DEG), false)
    expect(pinch.t.lock).toBe('zoom')
    expect(pinch.turn).toBe(0)
  })

  it('stops adding turn once a rotate lock is disarmed', () => {
    const t = createTouchOrbit()
    const first = gesture((u) => at(C.x, C.y, 75, u * 30 * DEG), true, 30, t)
    expect(first.turn / DEG).toBeCloseTo(30, 6)
    const p = at(C.x, C.y, 75, 60 * DEG)
    touchMove(t, 1, p[0][0], p[0][1], false)
    touchMove(t, 2, p[1][0], p[1][1], false)
    expect(takeTurn(t, H)).toBe(0)
  })

  it('unwraps a twist across ±π', () => {
    const { turn } = gesture((u) => at(C.x, C.y, 75, (150 + 60 * u) * DEG))
    expect(turn / DEG).toBeCloseTo(60, 6)
  })

  it('ends at a third finger; a later move turns nothing', () => {
    const t = createTouchOrbit()
    gesture((u) => at(C.x, C.y, 75, u * 30 * DEG), true, 30, t)
    touchDown(t, 3, 300, 600)
    expect(t.lock).toBe('none')
    const p = at(C.x, C.y, 75, 90 * DEG)
    touchMove(t, 1, p[0][0], p[0][1], true)
    touchMove(t, 2, p[1][0], p[1][1], true)
    expect(takeTurn(t, H)).toBe(0)
    expect(t.lock).toBe('none')
  })

  it('restarts from live positions after a lift and a new touch, with no jump', () => {
    const t = createTouchOrbit()
    gesture((u) => at(C.x, C.y, 75, u * 30 * DEG), true, 30, t)
    touchUp(t, 2)
    expect(t.lock).toBe('none')
    // Finger 1 wanders alone, then a new second finger lands far from where finger 2 was.
    touchMove(t, 1, 100, 300, true)
    expect(takeTurn(t, H)).toBe(0)
    touchDown(t, 4, 100, 500)
    expect(t.lock).toBe('pending')
    touchMove(t, 1, 100.5, 300, true)
    expect(t.lock).toBe('pending')
    expect(takeTurn(t, H)).toBe(0)
    expect(Math.abs(t.twist)).toBeLessThan(0.01)
  })

  it('forgets a finger whose lift was lost once a new first touch resets it', () => {
    const t = createTouchOrbit()
    touchDown(t, 1, 100, 100)
    touchReset(t)
    touchDown(t, 5, 100, 300)
    touchDown(t, 6, 250, 300)
    expect(t.count).toBe(2)
    expect(t.lock).toBe('pending')
  })

  it('ignores pointers it never saw go down', () => {
    const t = createTouchOrbit()
    touchUp(t, 9)
    touchMove(t, 9, 10, 10, true)
    expect(t.count).toBe(0)
    expect(t.lock).toBe('none')
  })
})

describe('clampAzimuth', () => {
  const CAP = 2.98

  it('holds a goal at the cap and turns back at once on reversing', () => {
    let goal = 0
    for (let i = 0; i < 20; i++) goal = clampAzimuth(goal + 10 * DEG, goal, -0.5, 0.5)
    expect(goal).toBe(0.5)
    goal = clampAzimuth(goal - 10 * DEG, 0.5, -0.5, 0.5)
    expect(goal).toBeCloseTo(0.5 - 10 * DEG, 12)
  })

  it('holds a goal that crosses π at the near cap, and turns back from it at once', () => {
    let goal = clampAzimuth(2.9 + 0.28, 2.9, -CAP, CAP)
    expect(goal).toBe(CAP)
    goal = clampAzimuth(goal + 0.2, CAP, -CAP, CAP)
    expect(goal).toBe(CAP)
    goal = clampAzimuth(goal - 0.1, CAP, -CAP, CAP)
    expect(goal).toBeCloseTo(CAP - 0.1, 12)
    expect(clampAzimuth(-3.2, -3.0, -CAP, CAP)).toBe(-CAP)
  })

  it('takes a goal a turn away to the turn nearest the view', () => {
    expect(clampAzimuth(2 * Math.PI + 0.2, 0.1, -Math.PI, Math.PI)).toBeCloseTo(0.2, 12)
  })

  it('leaves an open window unwrapped', () => {
    expect(clampAzimuth(7, 0.7, -Infinity, Infinity)).toBe(7)
    expect(clampAzimuth(7, 0.7, -Infinity, 1)).toBe(7)
  })
})

describe('wrapAngle', () => {
  it('wraps into (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12)
    expect(wrapAngle(-Math.PI)).toBe(Math.PI)
    expect(wrapAngle(0.3)).toBeCloseTo(0.3, 12)
  })
})
