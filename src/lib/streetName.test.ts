import { describe, expect, it } from 'vitest'
import { abbreviateStreet, entranceLabel, entranceParts, entranceSpoken, streetPair, type LabelledEntrance } from './streetName'

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

  it('handles the suffixed names the street files carry', () => {
    expect(abbreviateStreet('7th Avenue South')).toBe('7 Av S')
    expect(abbreviateStreet('1st Avenue Service Road')).toBe('1 Av Service Rd')
    expect(abbreviateStreet('East 14th Street Service Road')).toBe('E 14 St Service Rd')
    expect(abbreviateStreet('Park Avenue South')).toBe('Park Av S')
    expect(abbreviateStreet('Astoria Boulevard North')).toBe('Astoria Blvd N')
    expect(abbreviateStreet('Pelham Parkway South')).toBe('Pelham Pkwy S')
    expect(abbreviateStreet('Hoyt Avenue North')).toBe('Hoyt Av N')
    expect(abbreviateStreet('Avenue S')).toBe('Av S')
    expect(abbreviateStreet('Flatbush Avenue Extension')).toBe('Flatbush Av Ext')
    expect(abbreviateStreet('Mermaid Avenue Bus Loop')).toBe('Mermaid Av Bus Loop')
    expect(abbreviateStreet('Court Street')).toBe('Court St')
  })

  it('always shortens Saint and Fort', () => {
    expect(abbreviateStreet('Saint Nicholas Avenue')).toBe('St Nicholas Av')
    expect(abbreviateStreet('Fort Hamilton Parkway')).toBe('Ft Hamilton Pkwy')
  })

  it('keeps an ordinal not followed by a shortened type word', () => {
    expect(abbreviateStreet('5th Avenue of Art')).toBe('5th Avenue of Art')
    expect(abbreviateStreet('West Street')).toBe('West St')
  })

  it('leaves names with no type word alone', () => {
    expect(abbreviateStreet('Broadway')).toBe('Broadway')
    expect(abbreviateStreet('  The Bowery ')).toBe('The Bowery')
  })
})

const base: LabelledEntrance = { street: 'Bedford Avenue', cross: null, side: null, plaza: null, type: 'Stair', entry: true, exit: true }

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
    expect(entranceLabel({ ...base, side: 'east', exit: false })).toBe('Bedford Av · east side · entry only')
    expect(entranceLabel({ ...base, street: null, plaza: 'Times Square', entry: false })).toBe('Times Square · exit only')
  })
})

describe('entranceParts', () => {
  it('splits the street part from the rest, for two lines', () => {
    expect(entranceParts({ ...base, cross: 'North 7th Street', side: 'NE', type: 'Elevator' })).toEqual({
      head: 'Bedford Av & N 7 St',
      tail: 'NE corner · elevator',
    })
    expect(entranceParts(base)).toEqual({ head: 'Bedford Av', tail: '' })
  })

  it('takes the station-level wording: pair order, a nearby street and its side', () => {
    expect(entranceLabel({ ...base, cross: 'North 7th Street', side: 'NE' }, { swap: true })).toBe('N 7 St & Bedford Av · NE corner')
    expect(entranceLabel({ ...base, street: 'Broadway', side: 'west' }, { near: 'West 94th Street' })).toBe(
      'Broadway · west side at W 94 St',
    )
    expect(entranceLabel({ ...base, street: 'Broadway', side: 'median' }, { near: 'West 96th Street', of: 'S' })).toBe(
      'Broadway median south of W 96 St',
    )
    expect(entranceLabel({ ...base, street: 'Broadway', side: 'median' }, { near: 'West 95th Street', between: ['West 95th Street', 'West 96th Street'] })).toBe(
      'Broadway median between W 95 & W 96 St',
    )
    expect(entranceLabel({ ...base, street: 'Broadway', side: 'median' }, { near: 'West 95th Street' })).toBe('Broadway median near W 95 St')
    expect(entranceParts({ ...base, side: 'east' }, { near: 'North 7th Street', of: 'N' })).toEqual({
      head: 'Bedford Av',
      tail: 'east side · north of N 7 St',
    })
    expect(entranceParts({ ...base, street: 'Broadway' }, { near: 'West 94th Street' })).toEqual({ head: 'Broadway', tail: 'at W 94 St' })
    // A corner keeps its own cross street.
    expect(entranceLabel({ ...base, cross: 'North 7th Street', side: 'NE' }, { near: 'Driggs Avenue' })).toBe('Bedford Av & N 7 St · NE corner')
  })
})

describe('streetPair', () => {
  it('shares a closing type word, MTA style', () => {
    expect(streetPair('West 95th Street', 'West 96th Street')).toBe('W 95 & W 96 St')
    expect(streetPair('Broadway', 'West 96th Street')).toBe('Broadway & W 96 St')
    expect(streetPair('5th Avenue', 'West 42nd Street')).toBe('5 Av & W 42 St')
  })
})

describe('entranceSpoken', () => {
  it('says the file’s full names, spells corners out and joins with commas', () => {
    expect(entranceSpoken({ ...base, cross: 'North 7th Street', side: 'NE', type: 'Elevator' })).toBe(
      'Bedford Avenue and North 7th Street, northeast corner, elevator',
    )
  })

  it('keeps the label’s street order, sides, and entry or exit only', () => {
    expect(entranceSpoken({ ...base, street: 'West 94th Street', cross: 'Broadway', side: 'SE' }, { swap: true })).toBe(
      'Broadway and West 94th Street, southeast corner',
    )
    expect(entranceSpoken({ ...base, side: 'east', exit: false }, { near: 'North 7th Street', of: 'N' })).toBe(
      'Bedford Avenue, east side, north of North 7th Street, entry only',
    )
    expect(entranceSpoken({ ...base, side: 'west', entry: false }, { near: 'North 7th Street' })).toBe(
      'Bedford Avenue, west side at North 7th Street, exit only',
    )
  })

  it('says a median entrance with its streets in full, and a plaza by name', () => {
    expect(entranceSpoken({ ...base, street: 'Broadway', side: 'median' }, { between: ['West 95th Street', 'West 96th Street'] })).toBe(
      'Broadway median, between West 95th Street and West 96th Street',
    )
    expect(entranceSpoken({ ...base, street: null, plaza: 'Union Square' })).toBe('Union Square')
    expect(entranceSpoken({ ...base, street: null, plaza: null })).toBeNull()
  })
})
