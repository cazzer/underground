import { wrapAngle } from './orbitLimits'

/**
 * The visitor's turn of one focused station, as the largest net angle from where the focus began
 * (radians). Only armed gestures feed it, so a drift one way and back nets out instead of counting twice.
 */
export interface TurnMeter {
  /** Signed net turn since the reset. */
  net: number
  /** Largest |net| seen since the reset. */
  max: number
}

export function createTurnMeter(): TurnMeter {
  return { net: 0, max: 0 }
}

export function resetTurn(m: TurnMeter): void {
  m.net = 0
  m.max = 0
}

/** Adds one armed frame's azimuth step (any angle; wrapped to the short way) and returns the largest net turn so far. */
export function addTurn(m: TurnMeter, dTheta: number): number {
  m.net += wrapAngle(dTheta)
  const a = Math.abs(m.net)
  if (a > m.max) m.max = a
  return m.max
}
