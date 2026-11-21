import { Color } from 'three'
import type { Level, LocalPoint, StationInterior } from '../data/stationSchema'
import { stationAxis } from '../lib/interiorAxis'
import { levelFadeShares } from '../lib/interiorFade'
import { interiorFocusAnchor, levelLabels, paddedHull, type FocusAnchor, type LevelLabel } from '../lib/interiorFraming'
import { buildInteriorBuffers, RAIL_DROP_M, type Buffers, type InteriorRole, type Rgb } from '../lib/interiorGeometry'
import { toGround, type Ground } from '../lib/projection'
import { mixHex } from '../lib/routeColor'
import { ISO_POLAR } from '../lib/tilt'
import { MACHINE_DEPTH_FADE_SHARE, theme } from '../theme'
import { interiorLook } from './interiorLook'

/** A station interior, ready to draw: group origin, merged line buffers, labels, camera target. */
export interface InteriorModel {
  stationId: string
  /** Scene position of the interior's local origin (its anchor). */
  origin: Ground
  strong: Buffers
  fine: Buffers
  /** Draw both layers with a dashed material, cutting the segments `distances` marks (generated interiors). */
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
}

const HULL_PAD = 6

/**
 * Linear RGB per role and level: levels farther from the street (deeper, or higher at an elevated station) mix
 * toward the background (mixed in sRGB); machines fade less.
 */
function colorTable(levels: readonly Level[]): (role: InteriorRole, levelIndex: number) => Rgb {
  const table = new Map<string, Rgb>()
  const shares = levelFadeShares(levels)
  for (const [role, token] of Object.entries(ROLE_TOKEN)) {
    const machine = role === 'elevator' || role === 'escalator'
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

/** Builds the drawable model; throws (naming the element) on inconsistent interior data or nothing to draw. */
export function buildInteriorModel(interior: StationInterior): InteriorModel {
  const { yScale } = interiorLook
  const approximate = interior.generated !== undefined
  const colorOf = colorTable(interior.levels)
  const built = buildInteriorBuffers(interior, {
    yScale,
    stepRise: 0.18,
    railDrop: RAIL_DROP_M,
    entranceSize: 2.5,
    guides: interiorLook.guides,
    dashStructure: approximate,
    colorOf,
  })
  const origin = toGround(interior.anchor)
  const hull =
    interiorLook.veil === 'footprint'
      ? paddedHull([...interior.platforms.flatMap((p) => p.outline), ...interior.slabs.flatMap((s) => s.outline)], HULL_PAD)
      : null
  return {
    stationId: interior.stationId,
    origin,
    strong: built.strong,
    fine: hull ? withCutLine(built.fine, hull, colorOf('fare', 0)) : built.fine,
    dashed: approximate,
    approximate,
    labels: levelLabels(interior, yScale),
    focusAnchor: interiorFocusAnchor(origin, interior, yScale, Math.tan(ISO_POLAR)),
    axis: stationAxis(interior),
    hull,
    yScale,
  }
}
