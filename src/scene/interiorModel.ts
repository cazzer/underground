import { Color } from 'three'
import type { Level, LocalPoint, StationInterior } from '../data/stationSchema'
import { levelFadeShares } from '../lib/interiorFade'
import { interiorFocusAnchor, levelLabels, paddedHull, type FocusAnchor, type LevelLabel } from '../lib/interiorFraming'
import { buildInteriorBuffers, RAIL_DROP_M, type Buffers, type InteriorRole, type Rgb } from '../lib/interiorGeometry'
import { toGround, type Ground } from '../lib/projection'
import { mixHex } from '../lib/routeColor'
import { ISO_POLAR } from '../lib/tilt'
import { MACHINE_DEPTH_FADE_SHARE, theme } from '../theme'
import { interiorLook } from './interiorLook'
import { machineLook } from './machineLook'

/** A station interior, ready to draw: group origin, merged line buffers, labels, camera target. */
export interface InteriorModel {
  stationId: string
  /** Scene position of the interior's local origin (its anchor). */
  origin: Ground
  strong: Buffers
  fine: Buffers
  labels: LevelLabel[]
  /** Plan center and the toward-camera shift that puts it at mid-height mid-screen, seen isometrically. */
  focusAnchor: FocusAnchor
  /** Look B's cutaway outline (group-local), or null. */
  hull: LocalPoint[] | null
  yScale: number
}

const ROLE_TOKEN: Record<InteriorRole, string> = {
  outline: theme.interiorStroke,
  stair: theme.interiorStroke,
  elevator: theme.interiorElevator,
  escalator: machineLook.escalatorAccent ? theme.interiorEscalator : theme.interiorStroke,
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
    for (let i = 0; i < levels.length; i++) {
      const share = role === 'elevator' || role === 'escalator' ? MACHINE_DEPTH_FADE_SHARE : 1
      const fade = theme.interiorDepthFade * share * shares[i]!
      const c = new Color(mixHex(token, theme.background, fade))
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
  positions.set(fine.positions)
  colors.set(fine.colors)
  let o = fine.positions.length
  for (let i = 0; i < n; i++) {
    const a = hull[i]!
    const b = hull[(i + 1) % n]!
    positions.set([a[0], 0, a[1], b[0], 0, b[1]], o)
    colors.set([...rgb, ...rgb], o)
    o += 6
  }
  return { positions, colors }
}

/** Builds the drawable model; throws (naming the element) on inconsistent interior data or nothing to draw. */
export function buildInteriorModel(interior: StationInterior): InteriorModel {
  const { yScale } = interiorLook
  const colorOf = colorTable(interior.levels)
  const { strong, fine } = buildInteriorBuffers(interior, {
    yScale,
    stepRise: 0.18,
    railDrop: RAIL_DROP_M,
    entranceSize: 2.5,
    guides: interiorLook.guides,
    machines: machineLook.style,
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
    strong,
    fine: hull ? withCutLine(fine, hull, colorOf('fare', 0)) : fine,
    labels: levelLabels(interior, yScale),
    focusAnchor: interiorFocusAnchor(origin, interior, yScale, Math.tan(ISO_POLAR)),
    hull,
    yScale,
  }
}
