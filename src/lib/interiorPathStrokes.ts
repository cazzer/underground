/**
 * The exit path's writers (interiorPath.ts): one per stroke band (interiorDecks.ts), sharing one running dash phase,
 * the nested roof cuts a connector crossing bands takes, and the restroke of a connector in the path color. Pure.
 */
import type { Connector, StationInterior } from '../data/stationSchema'
import { drawElevatorShaft, drawElevatorStop, drawEscalator, drawRamp, drawWalkway, type ConnectorContext } from './interiorConnectors'
import { bandCutYs, strokeBandOf } from './interiorDecks'
import { SegmentWriter, SplitAtY, type Rgb, type SegmentSink, type Vec3 } from './interiorSegments'

export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])

/**
 * A SegmentWriter whose dashed segments carry one running dash distance, shared with every writer given the same
 * `run`, so the dash phase flows on along the path, across bands and roof cuts. Solid segments are 0, 0.
 */
export class PathWriter extends SegmentWriter {
  private readonly run: { m: number }

  constructor(run: { m: number }) {
    super()
    this.run = run
  }

  override segment(a: Vec3, b: Vec3, ca: Rgb, cb: Rgb = ca, dashed = false): void {
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
    this.colors.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2])
    if (!dashed) {
      this.distances.push(0, 0)
      return
    }
    const m = this.run.m
    this.run.m = m + dist3(a, b)
    this.distances.push(m, this.run.m)
  }

  /** A dashed segment with its own phase (0 to its length), outside the path's running one: a restroked walkway side. */
  ownDash(a: Vec3, b: Vec3, c: Rgb): void {
    this.segment(a, b, c, c)
    this.distances.splice(-1, 1, dist3(a, b))
  }
}

export interface BandSinks {
  /** One writer per stroke band (decks + 1), band 0 first. */
  writers: PathWriter[]
  /** The writer of the band level `i` draws in (`strokeBandOf`). */
  writerOf: (levelIndex: number) => PathWriter
  /** Where a connector from level `lower` up to `upper` writes: its band's writer, or a SplitAtY chain cut at each deck's
   *  train roof it crosses (`bandCutYs`), nested a band at a time as the interior's connectors are. */
  sinkFor: (lower: number, upper: number) => SegmentSink
}

export function bandSinks(interior: StationInterior, decks: readonly number[], railDrop: number, yScale: number): BandSinks {
  const run = { m: 0 }
  const writers = Array.from({ length: decks.length + 1 }, () => new PathWriter(run))
  const cuts = bandCutYs(interior, decks, railDrop, yScale)
  const chain = (from: number, to: number): SegmentSink => (from >= to ? writers[to]! : new SplitAtY(writers[from]!, chain(from + 1, to), cuts[from]!))
  const writerOf = (i: number): PathWriter => writers[strokeBandOf(i, decks)]!
  return { writers, writerOf, sinkFor: (lower, upper) => chain(strokeBandOf(lower, decks), strokeBandOf(upper, decks)) }
}

const NO_SINK: SegmentSink = { segment: () => {}, loop: () => {} }

/**
 * Restrokes connector `c` (level `lower` up to `upper`) in the path color, into the sinks its levels draw in (the fine
 * strokes are left out). A walkway's sides dash as the interior's do (`walkwayDashed`), each on its own phase; returns
 * whether any stroke dashed.
 */
export function restroke(ctx: Omit<ConnectorContext, 'strong' | 'fine'>, c: Connector, lower: number, upper: number, sinks: BandSinks, walkwayDashed: boolean): boolean {
  const run: ConnectorContext = { ...ctx, strong: sinks.sinkFor(lower, upper), fine: NO_SINK }
  if (c.kind === 'elevator') {
    drawElevatorShaft(run, c, lower, upper)
    for (const i of [lower, upper]) drawElevatorStop({ ...ctx, strong: sinks.writerOf(i), fine: NO_SINK }, c, i)
  } else if (c.kind === 'escalator') drawEscalator(run, c, lower, upper)
  else if (c.kind === 'walkway') {
    const w = sinks.writerOf(lower)
    const sides: SegmentSink = { segment: (a, b, ca, _cb, dashed) => (dashed ? w.ownDash(a, b, ca) : w.segment(a, b, ca)), loop: () => {} }
    drawWalkway({ ...run, strong: sides }, c, lower, walkwayDashed)
    return walkwayDashed
  } else drawRamp(run, c, lower, upper)
  return false
}
