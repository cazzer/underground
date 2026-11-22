import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { expectEquipmentIndex } from './loadEquipmentIndex'

const SOURCE = 'x/equipment.json'
const committed: unknown = JSON.parse(readFileSync(new URL('../../public/data/stations/equipment.json', import.meta.url), 'utf8'))

const good = (): Record<string, unknown> => ({
  format: 1,
  attribution: 'MTA',
  rowsUpdatedAt: '2026-11-21T11:20:45.000Z',
  machines: { EL1: { kind: 'elevator', serving: 'Street to platform.' }, ES2: { kind: 'escalator', serving: null } },
  stations: { A01: ['EL1', 'ES2'] },
})

describe('expectEquipmentIndex', () => {
  it('accepts the committed file', () => {
    expect(expectEquipmentIndex(committed, SOURCE)).toBe(committed)
  })

  it('accepts a small index', () => {
    const raw = good()
    expect(expectEquipmentIndex(raw, SOURCE)).toBe(raw)
  })

  it.each([
    ['not an object', null],
    ['a wrong format', { ...good(), format: 2 }],
    ['no machines', { ...good(), machines: undefined }],
    ['a bad kind', { ...good(), machines: { EL1: { kind: 'lift', serving: null } } }],
    ['a non-string serving', { ...good(), machines: { EL1: { kind: 'elevator', serving: 5 } } }],
    ['an unknown code', { ...good(), stations: { A01: ['EL9'] } }],
    ['an inherited code', { ...good(), stations: { A01: ['toString'] } }],
    ['a non-array list', { ...good(), stations: { A01: 'EL1' } }],
  ])('rejects %s', (_name, raw) => {
    expect(() => expectEquipmentIndex(raw, SOURCE)).toThrow(SOURCE)
  })
})
