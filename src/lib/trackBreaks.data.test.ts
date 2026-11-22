/**
 * The taper step's tolerance on the committed public/data: it is there for variants' mapped knots
 * (corridorShare.ts) and must leave every primary's drawn vertices as they are without it.
 */
import { describe, expect, it } from 'vitest'
import routesRaw from '../../public/data/routes.json?raw'
import depthsRaw from '../../public/data/station-depths.json?raw'
import shapesRaw from '../../public/data/shapes.json?raw'
import stationsRaw from '../../public/data/stations.json?raw'
import type { RoutesFile, ShapesFile, StationsFile } from '../data/schema'
import type { PackedDepthsFile } from '../data/stationSchema'
import { buildNetwork } from './network'
import { bandNetwork } from './networkBands'
import { lineBreaks } from './trackBreaks'
import { TRACK_OFFSET_M } from './trackOffset'

const network = buildNetwork(
  JSON.parse(stationsRaw) as StationsFile,
  JSON.parse(routesRaw) as RoutesFile,
  JSON.parse(shapesRaw) as ShapesFile,
  TRACK_OFFSET_M,
  JSON.parse(depthsRaw) as PackedDepthsFile,
  2,
)
const { shapes } = bandNetwork(network)

describe('real public/data: taper breaks', () => {
  it("gives every primary the same breaks as with no step tolerance", () => {
    const primaries = shapes.filter((s) => s.primary && s.bands.slot.d.length + s.bands.half.d.length > 0)
    expect(primaries.length).toBeGreaterThan(20)
    const changed = primaries.filter(
      (s) => lineBreaks(s.profile, s.bands, network.platformSpans, s.id).join() !== lineBreaks(s.profile, s.bands, network.platformSpans, s.id, 0).join(),
    )
    expect(changed.map((s) => s.id)).toEqual([])
  })
})
