import { describe, expect, it } from 'vitest'
import { createVotes, GROUPS, orderFromVotes, slotByPlace } from './corridorLateral'

const vote = (votes: Float64Array, left: number, right: number, w: number) => {
  votes[left * GROUPS + right]! += w
}

describe('orderFromVotes', () => {
  it('keeps rank order with no votes', () => {
    expect([...orderFromVotes(createVotes()).slice(0, 4)]).toEqual([0, 1, 2, 3])
  })

  it('moves groups to the side their votes favour, past groups with no say', () => {
    // A (0), C (1), E (2), B (3), D (4): B and D lie left of A and C; E never runs beside them.
    const votes = createVotes()
    for (const left of [3, 4]) for (const right of [0, 1]) vote(votes, left, right, 2)
    const place = orderFromVotes(votes)
    for (const left of [3, 4]) for (const right of [0, 1]) expect(place[left]).toBeLessThan(place[right]!)
    // Rank order still settles the pairs nothing voted on.
    expect(place[0]).toBeLessThan(place[1]!)
    expect(place[3]).toBeLessThan(place[4]!)
  })

  it('lets the heavier side win a contradiction', () => {
    const votes = createVotes()
    vote(votes, 1, 0, 5)
    vote(votes, 0, 1, 2)
    const place = orderFromVotes(votes)
    expect(place[1]).toBeLessThan(place[0]!)
  })
})

describe('slotByPlace', () => {
  const place = Int32Array.from({ length: GROUPS }, (_, g) => g)
  place[0] = 5
  place[5] = 0

  it('centers the routes present by place, times the sign', () => {
    // Groups 0, 1, 5: by place 5, 1, 0.
    const mask = (own: number) => ((1 << 0) | (1 << 1) | (1 << 5)) & ~(1 << own)
    expect([5, 1, 0].map((own) => slotByPlace(place, own, 1, mask(own)))).toEqual([-1, 0, 1])
    expect([5, 1, 0].map((own) => slotByPlace(place, own, -1, mask(own)))).toEqual([1, 0, -1])
  })

  it('is 0 alone, never -0', () => {
    expect(Object.is(slotByPlace(place, 3, -1, 0), 0)).toBe(true)
  })
})
