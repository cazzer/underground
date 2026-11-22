import { describe, expect, it } from 'vitest'
import { searchNav, type NavKey } from './searchNav'

const key = (k: string, mods: Partial<NavKey> = {}): NavKey => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods })
const to = (row: number, col: number) => ({ to: { row, col }, keepDefault: false })

describe('searchNav from the input', () => {
  it('moves down to the first button, or nowhere with no rows', () => {
    expect(searchNav('input', key('ArrowDown'), 3, 3)).toEqual(to(0, 0))
    expect(searchNav('input', key('ArrowDown'), 0, 3)).toBeNull()
  })
  it('leaves every other key to the input', () => {
    for (const k of ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'a', 'Enter']) expect(searchNav('input', key(k), 3, 3)).toBeNull()
  })
})

describe('searchNav on a row', () => {
  it('moves between rows in the same column, Up from the first to the input', () => {
    expect(searchNav({ row: 1, col: 2 }, key('ArrowUp'), 3, 3)).toEqual(to(0, 2))
    expect(searchNav({ row: 1, col: 2 }, key('ArrowDown'), 3, 3)).toEqual(to(2, 2))
    expect(searchNav({ row: 0, col: 1 }, key('ArrowUp'), 3, 3)).toEqual({ to: 'input', keepDefault: false })
  })
  it('stays on the last row, handled', () => {
    expect(searchNav({ row: 2, col: 1 }, key('ArrowDown'), 3, 3)).toEqual(to(2, 1))
  })
  it('clamps within the row', () => {
    expect(searchNav({ row: 0, col: 0 }, key('ArrowLeft'), 3, 3)).toEqual(to(0, 0))
    expect(searchNav({ row: 0, col: 2 }, key('ArrowRight'), 3, 3)).toEqual(to(0, 2))
    expect(searchNav({ row: 0, col: 0 }, key('ArrowRight'), 3, 1)).toEqual(to(0, 0))
    expect(searchNav({ row: 0, col: 0 }, key('ArrowRight'), 3, 3)).toEqual(to(0, 1))
  })
  it('jumps to the ends of the row', () => {
    expect(searchNav({ row: 1, col: 1 }, key('Home'), 3, 3)).toEqual(to(1, 0))
    expect(searchNav({ row: 1, col: 1 }, key('End'), 3, 3)).toEqual(to(1, 2))
  })
  it('sends a printable key to the input and lets it be typed', () => {
    expect(searchNav({ row: 1, col: 1 }, key('b'), 3, 3)).toEqual({ to: 'input', keepDefault: true })
    expect(searchNav({ row: 1, col: 1 }, key('1'), 3, 3)).toEqual({ to: 'input', keepDefault: true })
  })
  it('leaves Space, Enter, Tab and shortcuts alone', () => {
    for (const k of [key(' '), key('Enter'), key('Tab'), key('a', { ctrlKey: true }), key('k', { metaKey: true }), key('a', { altKey: true })])
      expect(searchNav({ row: 0, col: 0 }, k, 3, 3)).toBeNull()
  })
})
