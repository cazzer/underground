import { describe, expect, it } from 'vitest'
import { tripBarText } from './tripBar'

const name = (id: string) => ({ a: 'Astor Pl', u: '14 St-Union Sq' })[id] ?? id

describe('tripBarText', () => {
  it('names both ends', () => {
    expect(tripBarText({ from: 'a', to: 'u' }, name)).toEqual({ text: 'Astor Pl → 14 St-Union Sq', head: 'Astor Pl', tail: ' → 14 St-Union Sq', spoken: 'Trip from Astor Pl to 14 St-Union Sq' })
  })
  it('names a From alone', () => {
    expect(tripBarText({ from: 'a', to: null }, name)).toEqual({ text: 'From Astor Pl', head: 'From Astor Pl', tail: '', spoken: 'Trip from Astor Pl' })
  })
  it('names a To alone', () => {
    expect(tripBarText({ from: null, to: 'u' }, name)).toEqual({ text: 'To 14 St-Union Sq', head: '', tail: 'To 14 St-Union Sq', spoken: 'Trip to 14 St-Union Sq' })
  })
  it('falls back to Trip with no ends', () => {
    expect(tripBarText({ from: null, to: null }, name)).toEqual({ text: 'Trip', head: 'Trip', tail: '', spoken: 'Trip' })
  })
})
