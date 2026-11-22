import { describe, expect, it } from 'vitest'
import { abbreviateStreet, entranceLabel, type LabelledEntrance } from './streetName'

describe('abbreviateStreet', () => {
  it('shortens a closing type word', () => {
    expect(abbreviateStreet('Bedford Avenue')).toBe('Bedford Av')
    expect(abbreviateStreet('Ocean Parkway')).toBe('Ocean Pkwy')
    expect(abbreviateStreet('Union Square')).toBe('Union Sq')
    expect(abbreviateStreet('Fulton St.')).toBe('Fulton St')
    expect(abbreviateStreet('Grand Concourse')).toBe('Grand Concourse')
  })

  it('shortens an opening type word only before a single letter', () => {
    expect(abbreviateStreet('Avenue U')).toBe('Av U')
    expect(abbreviateStreet('Avenue of the Americas')).toBe('Avenue of the Americas')
    expect(abbreviateStreet('St Marks Place')).toBe('St Marks Pl')
  })

  it('drops an ordinal suffix before a type word, MTA style', () => {
    expect(abbreviateStreet('5th Avenue')).toBe('5 Av')
    expect(abbreviateStreet('West 96th Street')).toBe('W 96 St')
    expect(abbreviateStreet('North 7th Street')).toBe('N 7 St')
    expect(abbreviateStreet('West 42nd Street')).toBe('W 42 St')
  })

  it('shortens a compass word only before a numbered word', () => {
    expect(abbreviateStreet('West End Avenue')).toBe('West End Av')
    expect(abbreviateStreet('East Broadway')).toBe('East Broadway')
    expect(abbreviateStreet('South 4th Street')).toBe('S 4 St')
  })

  it('leaves names with no type word alone', () => {
    expect(abbreviateStreet('Broadway')).toBe('Broadway')
    expect(abbreviateStreet('  The Bowery ')).toBe('The Bowery')
  })
})

const base: LabelledEntrance = { street: 'Bedford Avenue', cross: null, side: null, plaza: null, type: 'Stair', entry: true }

describe('entranceLabel', () => {
  it('names a corner street first, then the corner', () => {
    expect(entranceLabel({ ...base, cross: 'North 7th Street', side: 'NE' })).toBe('Bedford Av & N 7 St · NE corner')
  })

  it('names a median entrance, with its cross street when known', () => {
    expect(entranceLabel({ ...base, street: 'Broadway', cross: 'West 95th Street', side: 'median' })).toBe(
      'Broadway median at W 95 St',
    )
    expect(entranceLabel({ ...base, street: 'Broadway', side: 'median' })).toBe('Broadway median')
  })

  it('names the side of a mid-block entrance', () => {
    expect(entranceLabel({ ...base, side: 'east' })).toBe('Bedford Av · east side')
  })

  it('gives the street, or street and cross, with no side', () => {
    expect(entranceLabel(base)).toBe('Bedford Av')
    expect(entranceLabel({ ...base, cross: 'North 7th Street' })).toBe('Bedford Av & N 7 St')
  })

  it('falls back to the plaza, or nothing', () => {
    expect(entranceLabel({ ...base, street: null, plaza: 'Times Square' })).toBe('Times Square')
    expect(entranceLabel({ ...base, street: null })).toBeNull()
  })

  it('marks elevators and exit-only entrances', () => {
    expect(entranceLabel({ ...base, type: 'Elevator', cross: 'North 7th Street', side: 'NE' })).toBe(
      'Bedford Av & N 7 St · NE corner · elevator',
    )
    expect(entranceLabel({ ...base, side: 'east', entry: false })).toBe('Bedford Av · east side · exit only')
    expect(entranceLabel({ ...base, street: null, plaza: 'Times Square', entry: false })).toBe('Times Square · exit only')
  })
})
