import { Color } from 'three'
import type { Level, LocalPoint, StationInterior } from '../data/stationSchema'
import { stationAxis } from '../lib/interiorAxis'
import { levelFadeShares } from '../lib/interiorFade'
import { interiorFootprint, type Footprint } from '../lib/interiorFootprint'
import { interiorFocusAnchor, levelLabels, paddedHull, type FocusAnchor, type LevelLabel } from '../lib/interiorFraming'
import { outlineSamples, type OutlineSamples } from '../lib/interiorOutline'
import { interiorDecks, strokeBandOf, trackDecks } from '../lib/interiorDecks'
import { buildInteriorBuffers, RAIL_DROP_M, STEP_RISE_M, type BandBuffers, type Buffers, type InteriorRole, type Rgb } from '../lib/interiorGeometry'
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
  /** Stroke band 0: the deepest deck and the levels below it (everything, with no deck or in look C). */
  strong: Buffers
  fine: Buffers
  /** The bands between decks (a multi-deck interior; empty with one), each drawn over the lifted trains of the deck below. */
  mid: BandBuffers[]
  /** The levels above the shallowest deck, drawn over every lifted train (empty in look C). */
  overStrong: Buffers
  overFine: Buffers
  /** The platform decks (interiorDecks: level indices, deepest first); empty in look C, which lifts no trains. */
  decks: readonly number[]
  /** Each platform track's deck by stop id (trackDecks): which lifted layer its trains draw in. */
  trackDecks: ReadonlyMap<string, number>
  /**
   * Draw every layer with a dashed material, cutting the segments `distances` marks (generated interiors, approximate
   * slabs). One approximate slab dashes every material in the interior, so its solid strokes lose their round caps
   * (the same trade-off generated interiors ship).
   */
  dashed: boolean
  /** Generated from an archetype template, or authored and marked approximate: the panel says it is estimated. */
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
  /** Points along its platform and slab outlines, group-local x, y (× yScale, before the depth factor), z triples, and
   *  their spacing (`outlineSamples`): the street names keep clear of them on screen. */
  outline: OutlineSamples
  /** Its ground footprint (interiorFootprint, FOOTPRINT_PAD_M): a neighbour's opens it on a tap (ScenePicker). */
  footprint: Footprint
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

/** Look B's cut line: the hull loop at street level, appended to a band's fine strokes. */
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

type Layers = Pick<InteriorModel, 'strong' | 'fine' | 'mid' | 'overStrong' | 'overFine'>

/** Look C draws the interior under the street and lifts no trains, so nothing needs to go over them. */
const decksOf = (interior: StationInterior): number[] => (interiorLook.under ? [] : interiorDecks(interior))

/** The line layers, with `outOfService` machines drawn as such (and Look B's cut line when there is a hull). */
function buildLayers(interior: StationInterior, hull: LocalPoint[] | null, outOfService: ReadonlySet<string>): Layers {
  const colorOf = colorTable(interior.levels)
  const decks = decksOf(interior)
  const built = buildInteriorBuffers(interior, {
    yScale: interiorLook.yScale,
    stepRise: STEP_RISE_M,
    railDrop: RAIL_DROP_M,
    entranceSize: ENTRANCE_SIZE_M,
    guides: interiorLook.guides,
    dashStructure: interior.generated !== undefined,
    decks,
    outOfService: (id) => outOfService.has(id),
    colorOf,
  })
  if (!hull) return built
  // Look B's cut line is at the street, so it goes in the street level's band (the top one, below ground).
  const cut = (fine: Buffers) => withCutLine(fine, hull, colorOf('fare', 0))
  const band = strokeBandOf(interior.levels.findIndex((l) => l.kind === 'street'), decks)
  if (band === 0) return { ...built, fine: cut(built.fine) }
  if (band === decks.length) return { ...built, overFine: cut(built.overFine) }
  return { ...built, mid: built.mid.map((m, i) => (i === band - 1 ? { ...m, fine: cut(m.fine) } : m)) }
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
  const generated = interior.generated !== undefined
  const approximate = generated || interior.approximate === true
  const origin = toGround(interior.anchor)
  const decks = decksOf(interior)
  const footprint = interiorFootprint(interior, yScale, origin)
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
    decks,
    trackDecks: trackDecks(interior, decks),
    dashed: generated || interior.slabs.some((s) => s.approximate === true),
    approximate,
    labels: levelLabels(interior, yScale),
    focusAnchor: interiorFocusAnchor(origin, interior, yScale, Math.tan(ISO_POLAR)),
    axis: stationAxis(interior),
    hull,
    yScale,
    entrances: interior.entrances.map(({ x, z, type }) => ({ x, z, type })),
    outline: outlineSamples(interior, yScale),
    footprint,
  }
}
