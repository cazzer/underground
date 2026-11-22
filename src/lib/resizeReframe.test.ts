import { describe, expect, it } from 'vitest'
import { interiorFreeRect } from './interiorCamera'
import { opensResizeWindow, panelMoveArms, RESIZE_WINDOW_MS, type LandingInput, type PanelMoveInput, type ResizeWindow } from './resizeReframe'

const phone = { width: 390, height: 844 }
const insets = { top: 60, bottom: 0 }
const bottom = (top: number) => interiorFreeRect(phone, insets, { left: 0, top, right: 390, bottom: 844 }).bottom

describe('opensResizeWindow', () => {
  const landing: LandingInput = {
    landedId: '127',
    mine: false,
    follows: false,
    flownId: '127',
    focusedId: '127',
    stationFront: true,
    bare: true,
    flyingOn: false,
  }

  it('opens on a bare station’s own landing', () => {
    expect(opensResizeWindow(landing)).toBe(true)
  })

  it('never reopens on the landing of a collapse or resize reframe', () => {
    expect(opensResizeWindow({ ...landing, mine: true })).toBe(false)
  })

  it('never opens for a station with an interior, a follow or a point flight', () => {
    expect(opensResizeWindow({ ...landing, bare: false })).toBe(false)
    expect(opensResizeWindow({ ...landing, follows: true })).toBe(false)
    expect(opensResizeWindow({ ...landing, landedId: null })).toBe(false)
  })

  it('waits for the late streets reframe: its landing opens it', () => {
    expect(opensResizeWindow({ ...landing, flyingOn: true })).toBe(false)
  })

  it('needs the station’s own pick, with the station panel in front then and now', () => {
    // A pick made while a train panel was in front: no flownId.
    expect(opensResizeWindow({ ...landing, flownId: null })).toBe(false)
    expect(opensResizeWindow({ ...landing, flownId: '120' })).toBe(false)
    expect(opensResizeWindow({ ...landing, stationFront: false })).toBe(false)
    expect(opensResizeWindow({ ...landing, focusedId: '120' })).toBe(false)
  })
})

describe('panelMoveArms', () => {
  const open: ResizeWindow = { stationId: '127', until: 1000 + RESIZE_WINDOW_MS, width: 390, height: 844 }
  const move: PanelMoveInput = {
    nowMs: 1400,
    flying: false,
    following: false,
    tookOver: false,
    lateArrival: false,
    focusedId: '127',
    width: 390,
    height: 844,
    before: bottom(410),
    after: bottom(366),
  }

  it('arms when the panel grows inside the window', () => {
    expect(panelMoveArms(open, move)).toBe(true)
  })

  it('arms on a shrink too: the reframe decides whether it gains', () => {
    expect(panelMoveArms(open, { ...move, before: move.after, after: move.before })).toBe(true)
  })

  it('never arms once the window has closed: a later poll leaves the camera alone', () => {
    expect(panelMoveArms(null, move)).toBe(false)
    expect(panelMoveArms(open, { ...move, nowMs: 1000 + RESIZE_WINDOW_MS })).toBe(false)
  })

  it('never arms after a gesture since the landing', () => {
    expect(panelMoveArms(open, { ...move, tookOver: true })).toBe(false)
  })

  it('never arms mid-flight, while following, or with a late streets reframe pending', () => {
    expect(panelMoveArms(open, { ...move, flying: true })).toBe(false)
    expect(panelMoveArms(open, { ...move, following: true })).toBe(false)
    expect(panelMoveArms(open, { ...move, lateArrival: true })).toBe(false)
  })

  it('never arms for another station', () => {
    expect(panelMoveArms(open, { ...move, focusedId: '120' })).toBe(false)
    expect(panelMoveArms(open, { ...move, focusedId: null })).toBe(false)
  })

  it('never arms once the viewport differs from the landing’s (a rotation)', () => {
    expect(panelMoveArms(open, { ...move, width: 844, height: 390 })).toBe(false)
  })

  it('ignores a panel appearing or closing and a move that leaves the free area as it was', () => {
    expect(panelMoveArms(open, { ...move, before: null })).toBe(false)
    expect(panelMoveArms(open, { ...move, after: null })).toBe(false)
    expect(panelMoveArms(open, { ...move, after: move.before })).toBe(false)
  })

  it('never arms for a desktop side panel, whose growth leaves the free area’s bottom alone', () => {
    const desktop = { width: 1440, height: 900 }
    const side = (b: number) => interiorFreeRect(desktop, insets, { left: 1040, top: 80, right: 1424, bottom: b }).bottom
    const wide = { ...open, width: 1440, height: 900 }
    expect(panelMoveArms(wide, { ...move, width: 1440, height: 900, before: side(400), after: side(620) })).toBe(false)
  })
})
