/**
 * Station interior (public/data/stations/<id>.json) to LineSegments2 buffers.
 * Type-only imports with .ts paths: scripts/lib/interiorRegistry.test.ts (nodenext) loads this file.
 */
import type { Connector, LocalPoint, StationInterior } from '../data/stationSchema.ts'

export type Rgb = readonly [number, number, number]

/** Estimated drop from the platform edge to the rail head, meters: where the interior draws its tracks. */
export const RAIL_DROP_M = 1.1

/** Same shape as lineBuffers.ts's LineBuffers (not imported: that module has extensionless imports). */
export interface Buffers {
  /** Six floats per segment: start xyz, end xyz, group-local meters. */
  positions: Float32Array
  /** Six floats per segment, matching `positions`. */
  colors: Float32Array
}

/** Strong strokes: outline, track, stair, elevator, entrance. Fine strokes: step, guide, fare. */
export type InteriorRole = 'outline' | 'track' | 'stair' | 'elevator' | 'entrance' | 'step' | 'guide' | 'fare'

export interface InteriorBufferOptions {
  /** Vertical exaggeration; x/z are never scaled. */
  yScale: number
  /** Real (unscaled) rise per drawn stair step, meters. */
  stepRise: number
  /** Estimated drop from the platform edge to the rail head, meters. */
  railDrop: number
  /** Side of the square drawn at each street entrance, meters. */
  entranceSize: number
  /**
   * Street reference: a vertical guide from every slab (mezzanine) vertex up to the street, and
   * the slab outline repeated at street level joining their tops. Platforms get none.
   */
  guides: boolean
  /** Linear RGB for a role on the level at `levelIndex` (0 = street). */
  colorOf: (role: InteriorRole, levelIndex: number) => Rgb
}

type Vec3 = readonly [number, number, number]

class SegmentWriter {
  readonly positions: number[] = []
  readonly colors: number[] = []

  segment(a: Vec3, b: Vec3, ca: Rgb, cb: Rgb = ca): void {
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
    this.colors.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2])
  }

  /** Closed loop through `points` at height y: one segment per point. */
  loop(points: readonly LocalPoint[], y: number, c: Rgb): void {
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      const q = points[(i + 1) % points.length]!
      this.segment([p[0], y, p[1]], [q[0], y, q[1]], c)
    }
  }

  polyline(points: readonly LocalPoint[], y: number, c: Rgb): void {
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1]!
      const q = points[i]!
      this.segment([p[0], y, p[1]], [q[0], y, q[1]], c)
    }
  }

  build(): Buffers {
    return { positions: new Float32Array(this.positions), colors: new Float32Array(this.colors) }
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/**
 * Two merged layers for one station interior, emitted from the deepest level up to the street.
 * Interior layers draw with depthTest off, so buffer order is the overlap rule: upper levels
 * paint over lower ones.
 */
export function buildInteriorBuffers(
  interior: StationInterior,
  opts: InteriorBufferOptions,
): { strong: Buffers; fine: Buffers } {
  const { yScale, colorOf } = opts
  const levelIndex = new Map(interior.levels.map((l, i) => [l.id, i]))
  const indexOf = (levelId: string, elementId: string): number => {
    const i = levelIndex.get(levelId)
    if (i === undefined) throw new Error(`Unknown level "${levelId}" in ${elementId}`)
    return i
  }
  const realY = (i: number) => interior.levels[i]!.y
  const strong = new SegmentWriter()
  const fine = new SegmentWriter()

  function ramp(c: Connector, li: number, ui: number): void {
    const dx = c.upper.x - c.lower.x
    const dz = c.upper.z - c.lower.z
    const run = Math.hypot(dx, dz)
    if (run < 0.01) throw new Error(`Connector "${c.id}" has no horizontal run`)
    const px = (-dz / run) * (c.width / 2)
    const pz = (dx / run) * (c.width / 2)
    const yL = realY(li) * yScale
    const yU = realY(ui) * yScale
    const cL = colorOf('stair', li)
    const cU = colorOf('stair', ui)
    const at = (t: number, side: number): Vec3 => [
      lerp(c.lower.x, c.upper.x, t) + side * px,
      lerp(yL, yU, t),
      lerp(c.lower.z, c.upper.z, t) + side * pz,
    ]
    strong.segment(at(0, 1), at(1, 1), cL, cU)
    strong.segment(at(0, -1), at(1, -1), cL, cU)
    strong.segment(at(0, -1), at(0, 1), cL)
    strong.segment(at(1, -1), at(1, 1), cU)
    if (c.kind === 'ramp') return
    const n = Math.max(1, Math.round((realY(ui) - realY(li)) / opts.stepRise))
    const sL = colorOf('step', li)
    const sU = colorOf('step', ui)
    for (let i = 1; i < n; i++) {
      const t = i / n
      const color = lerpRgb(sL, sU, t)
      fine.segment(at(t, -1), at(t, 1), color)
    }
  }

  function elevator(c: Connector, li: number, ui: number): void {
    const h = c.width / 2
    const yL = realY(li) * yScale
    const yU = realY(ui) * yScale
    const corners: LocalPoint[] = [
      [c.lower.x - h, c.lower.z - h],
      [c.lower.x + h, c.lower.z - h],
      [c.lower.x + h, c.lower.z + h],
      [c.lower.x - h, c.lower.z + h],
    ]
    const cL = colorOf('elevator', li)
    const cU = colorOf('elevator', ui)
    strong.loop(corners, yL, cL)
    strong.loop(corners, yU, cU)
    for (const [x, z] of corners) strong.segment([x, yL, z], [x, yU, z], cL, cU)
  }

  for (let li = interior.levels.length - 1; li >= 0; li--) {
    const level = interior.levels[li]!
    const y = level.y * yScale
    const platforms = interior.platforms.filter((p) => indexOf(p.level, p.id) === li)
    const slabs = interior.slabs.filter((s) => indexOf(s.level, s.id) === li)

    for (const p of platforms) {
      strong.loop(p.outline, y, colorOf('outline', li))
      for (const t of p.tracks) strong.polyline(t.path, (level.y - opts.railDrop) * yScale, colorOf('track', li))
    }
    for (const s of slabs) strong.loop(s.outline, y, colorOf('outline', li))
    for (const f of interior.fareLines) {
      if (indexOf(f.level, f.id) === li) fine.polyline(f.path, y, colorOf('fare', li))
    }

    for (const c of interior.connectors) {
      if (indexOf(c.lower.level, c.id) !== li) continue
      const ui = indexOf(c.upper.level, c.id)
      if (c.kind === 'elevator') elevator(c, li, ui)
      else ramp(c, li, ui)
    }

    if (opts.guides && level.kind !== 'street') {
      const cBottom = colorOf('guide', li)
      const cTop = colorOf('guide', 0)
      for (const s of slabs) {
        for (const [x, z] of s.outline) fine.segment([x, y, z], [x, 0, z], cBottom, cTop)
        fine.loop(s.outline, 0, cTop)
      }
    }

    if (level.kind === 'street') {
      const h = opts.entranceSize / 2
      for (const e of interior.entrances) {
        const square: LocalPoint[] = [
          [e.x - h, e.z - h],
          [e.x + h, e.z - h],
          [e.x + h, e.z + h],
          [e.x - h, e.z + h],
        ]
        strong.loop(square, y, colorOf('entrance', li))
      }
    }
  }

  return { strong: strong.build(), fine: fine.build() }
}
