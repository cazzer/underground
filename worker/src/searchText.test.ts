import { describe, expect, it } from 'vitest'
import { osaDistance, searchTokens } from './searchText'

const canon = (text: string) => searchTokens(text).map((t) => t.canon)

describe('searchTokens', () => {
  it('lowercases, strips punctuation and splits on separators', () => {
    expect(canon('Times Sq-42 St')).toEqual(['times', 'sq', '42', 'st'])
  })
  it('folds accents and drops apostrophes', () => {
    expect(canon("Prospect Park – Café d'Étoile")).toEqual(['prospect', 'pk', 'cafe', 'detoile'])
  })
  it('treats ordinals as plain numbers', () => {
    expect(canon('14th Street')).toEqual(['14', 'st'])
    expect(canon('2nd Ave')).toEqual(['2', 'av'])
  })
  it('splits digit and letter runs', () => {
    expect(canon('8av')).toEqual(['8', 'av'])
    expect(canon('Av U')).toEqual(['av', 'u'])
  })
  it('unifies abbreviations and drops stop words', () => {
    expect(canon('Saint Georges & the Heights')).toEqual(['st', 'georges', 'hts'])
    expect(canon('East Washington Boulevard')).toEqual(['e', 'wash', 'blvd'])
  })
  it('keeps the published spelling in raw and flags numbers', () => {
    const [a, b] = searchTokens('Avenue 86')
    expect(a).toEqual({ raw: 'avenue', canon: 'av', numeric: false, ordinal: false })
    expect(b).toEqual({ raw: '86', canon: '86', numeric: true, ordinal: false })
  })
  it('is empty for blank or stop-word-only text', () => {
    expect(searchTokens('  - ')).toEqual([])
    expect(searchTokens('the of')).toEqual([])
  })
})

describe('osaDistance', () => {
  it('counts edits and adjacent swaps as one', () => {
    expect(osaDistance('bedford', 'bedford')).toBe(0)
    expect(osaDistance('bedfrod', 'bedford')).toBe(1)
    expect(osaDistance('atlantc', 'atlantic')).toBe(1)
    expect(osaDistance('abc', 'xyz')).toBe(3)
    expect(osaDistance('', 'abc')).toBe(3)
  })
})
