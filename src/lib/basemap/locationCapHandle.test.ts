import { describe, expect, it } from 'vitest'
import { createLocationCap } from './locationCapHandle'

describe('createLocationCap', () => {
  it('reports the cap and tells listeners only when it goes on or off', () => {
    const cap = createLocationCap()
    const seen: boolean[] = []
    cap.subscribe((c) => seen.push(c))
    cap.step({ type: 'station' })
    expect(cap.isCapped()).toBe(false)
    cap.step({ type: 'pointFlight' })
    cap.step({ type: 'pointFlight' })
    expect(cap.isCapped()).toBe(true)
    // A tap keeps it.
    cap.step({ type: 'down', id: 1, x: 0, y: 0, touch: false, primary: true })
    cap.step({ type: 'move', id: 1, x: 3, y: 2 })
    cap.step({ type: 'up', id: 1 })
    expect(cap.isCapped()).toBe(true)
    cap.step({ type: 'wheel' })
    cap.step({ type: 'wheel' })
    expect(cap.isCapped()).toBe(false)
    expect(seen).toEqual([true, false])
  })

  it('stops calling a listener once unsubscribed', () => {
    const cap = createLocationCap()
    const seen: boolean[] = []
    const off = cap.subscribe((c) => seen.push(c))
    off()
    cap.step({ type: 'pointFlight' })
    expect(seen).toEqual([])
    expect(cap.isCapped()).toBe(true)
  })
})
