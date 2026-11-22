import { Color } from 'three'
import type { Level, LocalPoint, StationInterior } from '../data/stationSchema'
import { stationAxis } from '../lib/interiorAxis'
import { levelFadeShares } from '../lib/interiorFade'
import { interiorFocusAnchor, levelLabels, paddedHull, type FocusAnchor, type LevelLabel } from '../lib/interiorFraming'
import { buildInteriorBuffers, RAIL_DROP_M, trainLevelIndex, type Buffers, type InteriorRole, type Rgb } from '../lib/interiorGeometry'
import { toGround, type Ground } from '../lib/projection'
import { mixHex } from '../lib/routeColor'
import { ISO_POLAR } from '../lib/tilt'
import { MACHINE_DEPTH_FADE_SHARE, theme } from '../theme'
import { interiorLook } from './interiorLook'

/** A station interior, ready to draw: group origin, merged line buffers, labels, camera target. */
export interface InteriorModel {
  stationId: string
  /** The interior this was built from, for `interiorLayers` (machines out of service redraw its layers only). */
  interior: StationInterior
  /** A station complex: every station this interior covers (stationId first). Absent = stationId alone. */
  memberStationIds?: readonly string[]
  /** Scene position of the interior's local origin (its anchor). */
  origin: Ground
  strong: Buffers
  fine: Buffers
  /** The levels above the platform the lifted trains ride, drawn over those trains (empty in look C). */
  overStrong: Buffers
  overFine: Buffers
  /** Draw every layer with a dashed material, cutting the segments `distances` marks (generated interiors). */
  dashed: boolean
  /** Generated from an archetype template rather than surveyed: the panel says it is approximate. */
  approximate: boolean
  labels: LevelLabel[]
  /** Plan center and the toward-camera shift that puts it at mid-height mid-screen, seen isometrically. */
  focusAnchor: FocusAnchor
  /** Plan direction of the longest platform (stationAxis): a portrait landing turns it to run up the screen. */
  axis: LocalPoint
  /** Look B's cutaway outline (group-local), or null. */
  hull: LocalPoint[] | null
  yScale: number
  /** The street entrances it draws, group-local: the street layer skips its own mark for these (entranceMarks.ts). */
  entrances: { x: number; z: number; type: string }[]
}

const ROLE_TOKEN: Record<InteriorRole, string> = {
  outline: theme.interiorStroke,
  stair: theme.interiorStroke,
  elevator: theme.interiorElevator,
  escalator: theme.interiorEscalator,
  track: theme.interiorTrack,
  entrance: theme.interiorEntrance,
  step: theme.interiorFine,
  guide: theme.interiorFine,
  fare: theme.interiorFine,
  outage: theme.interiorOutage,
}

const HULL_PAD = 6
/** Side of the square drawn at each street entrance, meters; the street layer's own entrance marks match it. */
export const ENTRANCE_SIZE_M = 2.5

/**
 * Linear RGB per role and level: levels farther from the street (deeper, or higher at an elevated station) mix
 * toward the background (mixed in sRGB); machines fade less.
 */
function colorTable(levels: readonly Level[]): (role: InteriorRole, levelIndex: number) => Rgb {
  const table = new Map<string, Rgb>()
  const shares = levelFadeShares(levels)
  for (const [role, token] of Object.entries(ROLE_TOKEN)) {
    const machine = role === 'elevator' || role === 'escalator' || role === 'outage'
    for (let i = 0; i < levels.length; i++) {
      const share = machine ? MACHINE_DEPTH_FADE_SHARE : 1
      const depthFade = theme.interiorDepthFade * share * shares[i]!
      const c = new Color(mixHex(token, theme.background, depthFade))
      table.set(`${role}:${i}`, [c.r, c.g, c.b])
    }
  }
  return (role, i) => {
    const c = table.get(`${role}:${i}`)
    if (!c) throw new Error(`No interior color for ${role} on level ${i}`)
    return c
  }
}

/** Look B's cut line: the hull loop at street level, appended to the fine strokes. */
function withCutLine(fine: Buffers, hull: readonly LocalPoint[], rgb: Rgb): Buffers {
  const n = hull.length
  const positions = new Float32Array(fine.positions.length + n * 6)
  const colors = new Float32Array(positions.length)
  const distances = new Float32Array(fine.distances.length + n * 2)
  positions.set(fine.positions)
  colors.set(fine.colors)
  distances.set(fine.distances)
  let o = fine.positions.length
  for (let i = 0; i < n; i++) {
    const a = hull[i]!
    const b = hull[(i + 1) % n]!
    positions.set([a[0], 0, a[1], b[0], 0, b[1]], o)
    colors.set([...rgb, ...rgb], o)
    o += 6
  }
  return { positions, colors, distances }
}

type Layers = Pick<InteriorModel, 'strong' | 'fine' | 'overStrong' | 'overFine'>

/** The four line layers, with `outOfService` machines drawn as such (and Look B's cut line when there is a hull). */
function buildLayers(interior: StationInterior, hull: LocalPoint[] | null, outOfService: ReadonlySet<string>): Layers {
  const colorOf = colorTable(interior.levels)
  // Look C draws the interior under the street and lifts no trains, so nothing needs to go over them.
  const splitLevel = interiorLook.under ? undefined : trainLevelIndex(interior)
  const built = buildInteriorBuffers(interior, {
    yScale: interiorLook.yScale,
    stepRise: 0.18,
    railDrop: RAIL_DROP_M,
    entranceSize: ENTRANCE_SIZE_M,
    guides: interiorLook.guides,
    dashStructure: interior.generated !== undefined,
    splitLevel,
    outOfService: (id) => outOfService.has(id),
    colorOf,
  })
  // Look B's cut line is at the street, so it goes over the trains when the street does (below ground).
  const cutInOver = splitLevel !== undefined && interior.levels.findIndex((l) => l.kind === 'street') < splitLevel
  return {
    strong: built.strong,
    fine: hull && !cutInOver ? withCutLine(built.fine, hull, colorOf('fare', 0)) : built.fine,
    overStrong: built.overStrong,
    overFine: hull && cutInOver ? withCutLine(built.overFine, hull, colorOf('fare', 0)) : built.overFine,
  }
}

/**
 * The model's line layers with the machines in `outKey` (their connector ids, comma-joined; empty for none) out of
 * service. Empty is the model's own buffers, so a station with no outage costs nothing. A throw while rebuilding
 * is logged and the model's own buffers stand: an outage is never worth losing the interior over.
 */
export function interiorLayers(model: InteriorModel, outKey: string): Layers {
  if (outKey === '') return model
  try {
    return buildLayers(model.interior, model.hull, new Set(outKey.split(',')))
  } catch (err) {
    console.error(`Couldn't draw the outages at ${model.stationId}`, err)
    return model
  }
}

/** Builds the drawable model; throws (naming the element) on inconsistent interior data or nothing to draw. */
export function buildInteriorModel(interior: StationInterior): InteriorModel {
  const { yScale } = interiorLook
  const approximate = interior.generated !== undefined
  const origin = toGround(interior.anchor)
  const hull =
    interiorLook.veil === 'footprint'
      ? paddedHull([...interior.platforms.flatMap((p) => p.outline), ...interior.slabs.flatMap((s) => s.outline)], HULL_PAD)
      : null
  return {
    stationId: interior.stationId,
    interior,
    ...(interior.memberStationIds ? { memberStationIds: interior.memberStationIds } : {}),
    origin,
    ...buildLayers(interior, hull, new Set()),
    dashed: approximate,
    approximate,
    labels: levelLabels(interior, yScale),
    focusAnchor: interiorFocusAnchor(origin, interior, yScale, Math.tan(ISO_POLAR)),
    axis: stationAxis(interior),
    hull,
    yScale,
    entrances: interior.entrances.map(({ x, z, type }) => ({ x, z, type })),
  }
}
