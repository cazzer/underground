import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { InterleavedBufferAttribute } from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { useFocus } from '../lib/focus'
import type { Network } from '../lib/network'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { compactTies, focusedTie, STUB_DEPTH_M } from '../lib/stationTie'
import { depthFactor, depthScaleY } from '../lib/tilt'
import { theme } from '../theme'
import { DimLineMaterial, writeLineDim } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import { MARKER_Y } from './markerShape'
import { RENDER_ORDER } from './renderOrder'
import { useCoveredTies } from './useCoveredTies'
import type { CoveredStation } from './useSceneInteriors'

/**
 * Ties fade in from TIE_FROM_DEPTH of the depth factor, fully shown TIE_RAMP later: below that a tie is shorter on
 * screen than the ring radius, a stray tick under the ring rather than a connection. (0.35, not 0.3: the tilt reaches
 * a depth farther out now, where the tie is shorter on screen; LABELS_FROM_DEPTH moved the same way.)
 */
const TIE_FROM_DEPTH = 0.35
const TIE_RAMP = 0.3
const tieOpacity = (depth: number): number => Math.min(Math.max((depth - TIE_FROM_DEPTH) / TIE_RAMP, 0), 1)

interface StationTiesProps {
  network: Network
  /** The focused station's street marker is drawn (no interior, or its load failed): it keeps a tether. */
  focusedMarker: boolean
  /** Stations a drawn interior stands in for beside the focused one (its covered complex siblings, every other drawn
   *  interior's stations): their ties leave this layer with the focused one's. */
  hiddenStations: readonly string[]
  /** The stations among them that another drawn interior stands in for: their ties draw in useCoveredTies' layer, fading. */
  covered: readonly CoveredStation[]
  /** This frame's trip look (SubwayLines, -0.25): every tie dims with the network. */
  levels: EmphasisLevels
}

/**
 * A thin vertical tie from each street-level station marker down to its platform tracks, for stations whose
 * tracks descend to a station depth (network.stationTrackY), so a tilted view shows which sunken line the
 * marker belongs to. It drops straight down from the GTFS station point, which sits between the tracks: right
 * for island platforms, roughly right for side platforms. One merged LineSegments2 drawn at the depth factor
 * (tilt.ts): scale.y follows it as the lines' does, so each tie ends on its sunken track; the opacity ramps in
 * once the tie is long enough to read (tieOpacity).
 * A focused station with an interior draws no marker, so its tie is left out too, and so are its complex siblings' and
 * every other drawn interior's stations' (o3r.4; those fade in their own layer instead, useCoveredTies)
 * (compactTies shifts the ties that remain to the front, in order, and the layer draws only those). With no interior
 * (focusedMarker) its marker stays and so does its tie; a station with no depth gets a short stub (stationTie.ts)
 * instead, written in the slot just after the drawn ties. Under a trip every tie dims with the network (DimLineMaterial).
 */
export function StationTies({ network, focusedMarker, hiddenStations, covered, levels }: StationTiesProps) {
  const { focusedId } = useFocus()
  const ties = useMemo(() => {
    const positions: number[] = []
    const indexOf = new Map<string, number>()
    for (const [id, y] of network.stationTrackY) {
      const station = network.stationById.get(id)
      if (!station) throw new Error(`Station tie: unknown station ${id}`)
      indexOf.set(id, positions.length / 6)
      positions.push(station.pos.x, MARKER_Y, station.pos.z, station.pos.x, y, station.pos.z)
    }
    const count = positions.length / 6
    // The spare slot after the real ties holds the focused stub, when there is one.
    positions.push(0, MARKER_Y, 0, 0, -STUB_DEPTH_M, 0)
    const material = new DimLineMaterial(
      { color: theme.stationStroke, linewidth: theme.stationTieWidth, transparent: true, depthTest: false, depthWrite: false },
      theme.background,
    )
    const l = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), material)
    l.renderOrder = RENDER_ORDER.stationTie
    l.frustumCulled = false
    return { lines: l, all: new Float32Array(positions), indexOf, count }
  }, [network])
  const lines = ties.lines
  const lastDepth = useRef(NaN)

  // Every tie but the hidden ones (the focused station's and its siblings'): the rest shift to the front in order
  // and only they are drawn. A fallback station without a tie gets the stub written at slot `drawn`, right after
  // them (a fallback has no siblings, so nothing is dropped then).
  useLayoutEffect(() => {
    const attr = ties.lines.geometry.attributes.instanceStart as InterleavedBufferAttribute
    const buf = attr.data.array as Float32Array
    buf.set(ties.all)
    const n = ties.count
    const i = focusedId ? ties.indexOf.get(focusedId) : undefined
    const station = focusedId ? network.stationById.get(focusedId) : undefined
    const plan = station ? focusedTie(i !== undefined, focusedMarker) : 'keep'
    const dropped = new Set<number>()
    if (plan === 'drop' && i !== undefined) dropped.add(i)
    for (const id of hiddenStations) {
      const j = ties.indexOf.get(id)
      if (j !== undefined) dropped.add(j)
    }
    let drawn = compactTies(buf, n, dropped)
    if (plan === 'stub' && station) {
      const o = drawn * 6
      buf[o] = buf[o + 3] = station.pos.x
      buf[o + 1] = MARKER_Y
      buf[o + 2] = buf[o + 5] = station.pos.z
      buf[o + 4] = -STUB_DEPTH_M
      drawn++
    }
    ties.lines.geometry.instanceCount = drawn
    attr.data.needsUpdate = true
  }, [ties, network, focusedId, focusedMarker, hiddenStations])

  useEffect(
    () => () => {
      lines.geometry.dispose()
      lines.material.dispose()
    },
    [lines],
  )

  useFrame((state) => {
    writeLineDim(lines.material, levels.networkDim)
    const depth = depthFactor(cameraDistance(state))
    if (depth === lastDepth.current) return
    lastDepth.current = depth
    const opacity = tieOpacity(depth)
    lines.visible = opacity > 0
    lines.scale.y = depthScaleY(depth)
    lines.material.opacity = opacity
  })

  const fading = useCoveredTies(network, covered, levels, tieOpacity)
  return (
    <>
      <primitive object={lines} />
      {fading && <primitive object={fading} />}
    </>
  )
}
