/** Fixtures for the archetype classifier, in station-local meters.
 *  The geometry is SYNTHETIC and approximate: layouts are shaped like the named stations (platform
 *  widths, track spacing, which sides have platforms) but are not surveyed and not copied from any
 *  source, except Bedford Av's platform polygon and entrance points, which come from the pinned
 *  data/stations/L08.sources.json extract (c) OpenStreetMap contributors (ODbL) and NY Open Data.
 *  Authoring frame for the synthetic ones: u along the bearing, v to its right, via makeFrame. */
import type { EquipmentFact, PlatformFact, StationFacts, Structure, TrackFact } from './stationFacts.ts'
import { makeFrame } from './stationGeometry.ts'

const ANCHOR = { lat: 40.7, lon: -74 }
const PLATFORM_U: [number, number] = [-75, 75]
const TRACK_U: [number, number] = [-110, 110]

export const equipmentFact = (code: string, serving: string, rise: string | null = null): EquipmentFact => ({ code, kind: 'elevator', serving, rise, at: [0, 0] })

export interface BuildOptions {
  complex?: boolean
  levelTags?: (string | null)[]
  equipment?: EquipmentFact[]
  /** [u, v] entrance points. Default: one each side, 15 m beyond the outermost platform edge. */
  entrances?: [number, number][]
}

/** `platforms` and `tracks` are v ranges and v positions in the station's [u, v] frame. */
export function buildStation(
  id: string,
  structure: Structure,
  bearingDeg: number,
  platforms: [number, number][],
  tracks: number[],
  o: BuildOptions = {},
): StationFacts {
  const { fromUV } = makeFrame({ anchor: ANCHOR, bearingDeg })
  const outer = Math.max(...platforms.flat().map(Math.abs)) + 15
  const entrances = o.entrances ?? [[-60, -outer], [60, outer]]
  return {
    stationId: id,
    name: id,
    structure,
    complex: o.complex ?? false,
    platforms: platforms.map(([v0, v1], i): PlatformFact => ({
      osmWay: 1000 + i,
      outline: [fromUV([PLATFORM_U[0], v0]), fromUV([PLATFORM_U[1], v0]), fromUV([PLATFORM_U[1], v1]), fromUV([PLATFORM_U[0], v1])],
      levelTag: o.levelTags?.[i] ?? o.levelTags?.[0] ?? null,
    })),
    tracks: tracks.map((v, i): TrackFact => ({ ref: `T${i + 1}`, source: 'osm', path: [fromUV([TRACK_U[0], v]), fromUV([TRACK_U[1], v])] })),
    equipment: o.equipment ?? [],
    entrances: entrances.map(([u, v]) => ({ at: fromUV([u, v]), type: 'Stair' })),
  }
}

const MEZZ = [equipmentFact('EL1', 'mezzanine to platform for service in both directions')]

/** Island, 2 tracks, E&E names a mezzanine. Real L08 platform and entrances; tracks at +-4.7 m as authored. */
export function bedfordAv(): StationFacts {
  const frame = makeFrame({ anchor: { lat: 40.717398, lon: -73.95701 }, bearingDeg: 129.6 })
  const ring: [number, number][] = [[40.717841, -73.9576596], [40.7177973, -73.9577044], [40.7169545, -73.9563611], [40.7169985, -73.9563149]]
  const entrances: [number, number][] = [
    [40.7168959, -73.9565414], [40.7169125, -73.9563763], [40.7170278, -73.9562626], [40.7171349, -73.9562734], [40.7176329, -73.9578755],
    [40.717669, -73.957588], [40.717778, -73.9574692], [40.7179059, -73.9575989], [40.7179977, -73.9574904],
  ]
  const line = (ref: string, v: number): TrackFact => ({ ref, source: 'osm', path: [frame.fromUV([-85, v]), frame.fromUV([85, v])] })
  return {
    stationId: 'L08',
    name: 'Bedford Av',
    structure: 'subway',
    complex: false,
    platforms: [{ osmWay: 906963980, outline: ring.map(([lat, lon]) => frame.fromLatLon(lat, lon)), levelTag: '-2' }],
    tracks: [line('L08N', -4.7), line('L08S', 4.7)],
    equipment: [equipmentFact('EL358', 'mezzanine to platform for service in both directions'), equipmentFact('EL359', 'Bedford Av and N 7 St (NE corner) to mezzanine for service in both directions')],
    entrances: entrances.map(([lat, lon]) => ({ at: frame.fromLatLon(lat, lon), type: 'Stair' })),
  }
}

/** Side platforms, a mezzanine, 2 tracks. */
export const firstAvL = (): StationFacts => buildStation('L06', 'subway', 70, [[-10, -5.5], [5.5, 10]], [-2.4, 2.4], { levelTags: ['-3'], equipment: MEZZ })

/** Shallow side platforms with express tracks between them, entered from the street on both sides. */
export const seventyNinthSt1 = (): StationFacts => buildStation('S79', 'subway', 28, [[-14, -9], [9, 14]], [-6.6, -2.9, 2.9, 6.6], { levelTags: ['-1'] })

/** Two islands, 4 tracks: local | island | express express | island | local. */
export const ninetySixthSt123 = (): StationFacts =>
  buildStation('S96', 'subway', 28, [[-10, -4], [4, 10]], [-12.2, -1.8, 1.8, 12.2], { levelTags: ['-2'] })

export const livoniaAv = (): StationFacts => buildStation('L22', 'elevated', 100, [[-3.2, 3.2]], [-5, 5], { levelTags: ['2'] })

/** 3 tracks, a side platform beyond each outer track. */
export const fortiethStLowery = (): StationFacts => buildStation('F40', 'elevated', 100, [[-9, -5], [7, 11]], [-3.2, 0.5, 4.2])

/** 3 tracks: one side platform and one island. */
export const sixtyFirstStWoodside = (): StationFacts => buildStation('F61', 'elevated', 100, [[-14, -10], [0, 6]], [-7.8, -4, 8.2])

/** Deep: the depth comes from the E&E street-to-platform rise (synthetic text, 180 ft 6 in = 55.1 m). */
export const oneNinetyFirstSt = (): StationFacts =>
  buildStation('S191', 'subway', 20, [[-3.5, 3.5]], [-5.4, 5.4], { equipment: [equipmentFact('EL1', 'street to platform for service in both directions', "180' - 6in")] })

/** Open cut, side platforms, 4 tracks. */
export const avenueH = (): StationFacts => buildStation('AH', 'open-cut', 95, [[-14, -9], [9, 14]], [-6.6, -2.9, 2.9, 6.6])
