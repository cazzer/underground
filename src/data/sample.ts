import type { LatLon } from '../lib/projection'

/** Hand-made sample data near lower Manhattan. Not real service. Replaced by preprocessed JSON later. */
export interface SampleStation extends LatLon {
  id: string
  name: string
}

/** A stop is a station id, or a bare coordinate used as a path waypoint. */
export type SampleStop = string | LatLon

export interface SampleLine {
  id: string
  name: string
  stops: readonly SampleStop[]
}

export const SAMPLE_STATIONS: readonly SampleStation[] = [
  { id: 'battery', name: 'Battery Park', lat: 40.7033, lon: -74.017 },
  { id: 'bowling', name: 'Bowling Green', lat: 40.7046, lon: -74.0141 },
  { id: 'wall', name: 'Wall St', lat: 40.7074, lon: -74.0113 },
  { id: 'fulton', name: 'Fulton St', lat: 40.7103, lon: -74.0095 },
  { id: 'cityhall', name: 'City Hall', lat: 40.7133, lon: -74.0069 },
  { id: 'canal', name: 'Canal St', lat: 40.719, lon: -74.0016 },
  { id: 'houston', name: 'Houston St', lat: 40.7283, lon: -74.0052 },
  { id: 'unionsq', name: 'Union Sq', lat: 40.7359, lon: -73.9906 },
]

export const SAMPLE_LINES: readonly SampleLine[] = [
  {
    id: 'L1',
    name: 'Line 1',
    stops: ['battery', 'bowling', 'wall', 'fulton', 'cityhall', 'canal', 'houston'],
  },
  {
    id: 'L2',
    name: 'Line 2',
    stops: ['wall', { lat: 40.71, lon: -74.003 }, 'canal', { lat: 40.724, lon: -73.998 }, 'unionsq'],
  },
  {
    id: 'L3',
    name: 'Line 3',
    stops: ['fulton', { lat: 40.715, lon: -74.011 }, 'houston', 'unionsq'],
  },
]
