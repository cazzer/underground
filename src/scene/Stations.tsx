import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CircleGeometry, Color, DynamicDrawUsage, RingGeometry, type InstancedMesh } from 'three'
import { useFocus } from '../lib/focus'
import { interiorOpacity } from '../lib/interiorReveal'
import { dimLineRgbInto, srgb01 } from '../lib/lineDim'
import { writeInstanceMatrix, writeMarkerMatrices } from '../lib/markerMatrices'
import type { Station } from '../lib/network'
import type { Ground } from '../lib/projection'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import type { TripMark } from '../lib/tripMarks'
import { theme } from '../theme'
import { cameraDistance, markerRadiusPx, screenScale } from './cameraDistance'
import { FocusRing } from './FocusRing'
import { MARKER_MIN_METERS, MARKER_Y, RING_INNER, SEGMENTS } from './markerShape'
import { RENDER_ORDER } from './renderOrder'
import { useHeld } from './useHeld'
import type { CoveredStation } from './useSceneInteriors'

const BACKGROUND = srgb01(theme.background)

interface StationsProps {
  stations: readonly Station[]
  /** Draw the focused station's marker too (it has no interior, or its load failed). */
  focusedMarker: boolean
  /** The focused interior's covered complex siblings: their markers hide with the focused one's. */
  hiddenStations: readonly string[]
  /** Stations a drawn interior other than the focused one stands in for: their rings fade toward the background by
   *  interiorOpacity x that interior's presence, so a joining or leaving view interior leaves no gap and no pop. */
  covered: readonly CoveredStation[]
  /** Every station the trip's drawn journey calls at (TripRouteDraw.stations); null with none. */
  tripStations: readonly string[] | null
  /** The trip's station marks (TripRouteDraw.marks); null with none: a focus ring on one draws outside it. */
  tripMarks: readonly TripMark[] | null
  /** The location fix's ground point while its reticle shows (read only, sizes a focus ring round a grown start mark). */
  fix: Ground | null
  /** This frame's trip look (SubwayLines, -0.25): the other stations' rings dim with the network. */
  levels: EmphasisLevels
}

/**
 * All station markers as two instanced meshes (fill, then ring). The focused station's marker is hidden
 * (its panel and interior mark it), and so are its complex siblings' (the one interior covers them) and every other
 * drawn interior's stations (o3r.4); they stay pickable, since ScenePicker picks in screen space. A station with no
 * interior (`focusedMarker`) keeps its marker, plus a `theme.stationFocus` FocusRing above the trains. While a trip
 * shows, the rings of stations its journey doesn't call at mix toward the background by the network's dim (as the
 * lines do, lineDim.ts), rewritten only while that dim or the journey's stations change.
 */
export function Stations({ stations, focusedMarker, hiddenStations, covered, tripStations, tripMarks, levels, fix }: StationsProps) {
  const fill = useRef<InstancedMesh>(null)
  const ring = useRef<InstancedMesh>(null)
  const { focusedId } = useFocus()
  const focusedIndex = useMemo(
    () => (focusedId ? stations.findIndex((s) => s.id === focusedId) : -1),
    [stations, focusedId],
  )
  /** Marker instances to collapse: the focused one unless it is drawn as the fallback, and every hidden station. */
  const hidden = useMemo(() => {
    const indexOf = new Map(stations.map((s, i) => [s.id, i]))
    const out: number[] = []
    if (focusedIndex >= 0 && !focusedMarker) out.push(focusedIndex)
    for (const id of hiddenStations) {
      const i = indexOf.get(id)
      if (i !== undefined) out.push(i)
    }
    return out
  }, [stations, focusedIndex, focusedMarker, hiddenStations])
  const positions = useMemo(() => stations.map((s) => s.pos), [stations])
  // Pre-rotated flat on the ground, so each instance matrix is only scale plus translate.
  const geometry = useMemo(
    () => ({
      fill: new CircleGeometry(1, SEGMENTS).rotateX(-Math.PI / 2),
      ring: new RingGeometry(RING_INNER, 1, SEGMENTS).rotateX(-Math.PI / 2),
    }),
    [],
  )
  const stroke = useMemo(() => new Color(theme.stationStroke), [])
  const drawn = useRef<{ scale: number; hidden: readonly number[] | null }>({ scale: NaN, hidden: null })
  // The last journey's stations, so they stay full while its dim eases out.
  const heldTrip = useHeld(tripStations)
  const heldMarks = useHeld(tripMarks)
  const focusedRole = (focusedId && heldMarks?.find((m) => m.stationId === focusedId)?.role) || null
  const onTrip = useMemo(() => {
    const ids = new Set(heldTrip)
    return Uint8Array.from(stations, (s) => (ids.has(s.id) ? 1 : 0))
  }, [stations, heldTrip])
  const tint = useMemo(() => ({ full: new Float32Array([stroke.r, stroke.g, stroke.b]), dimmed: new Float32Array(3) }), [stroke])
  const tinted = useRef<{ dim: number; onTrip: Uint8Array | null }>({ dim: NaN, onTrip: null })
  /** Each covered station's instance and the fade its ring was last written at (NaN: rewrite it). */
  const fades = useMemo(() => {
    const indexOf = new Map(stations.map((s, i) => [s.id, i]))
    const list = covered.filter((c) => indexOf.has(c.id))
    return {
      index: Int32Array.from(list, (c) => indexOf.get(c.id)!),
      presence: list.map((c) => c.presence),
      last: new Float32Array(list.length).fill(NaN),
      /** 1 while fully faded: collapsed to scale 0, so its background disc doesn't mask the lines passing it. */
      gone: new Uint8Array(list.length),
      rgb: new Float32Array(3),
      /** A station's collapse changed: the matrices need a rewrite. */
      moved: true,
    }
  }, [stations, covered])
  // A station no longer covered gets its own ring color back: the next frame rewrites every ring.
  useLayoutEffect(() => {
    tinted.current.dim = NaN
  }, [fades])

  useEffect(
    () => () => {
      geometry.fill.dispose()
      geometry.ring.dispose()
    },
    [geometry],
  )

  // Ring colors must exist before the first frame, or the shader compiles without instance colors.
  useLayoutEffect(() => {
    const f = fill.current
    const r = ring.current
    if (!f || !r) return
    f.instanceMatrix.setUsage(DynamicDrawUsage)
    r.instanceMatrix.setUsage(DynamicDrawUsage)
    for (let i = 0; i < stations.length; i++) r.setColorAt(i, stroke)
    r.instanceColor!.needsUpdate = true
    drawn.current.scale = NaN
    tinted.current.dim = 0
    tinted.current.onTrip = null
  }, [stations, stroke])

  useFrame((state) => {
    const f = fill.current
    const r = ring.current
    if (!f || !r) return
    const t = tinted.current
    if (levels.networkDim !== t.dim || (onTrip !== t.onTrip && levels.networkDim > 0)) {
      t.dim = levels.networkDim
      t.onTrip = onTrip
      dimLineRgbInto(tint.dimmed, tint.full, BACKGROUND, t.dim)
      const colors = r.instanceColor!.array as Float32Array
      for (let i = 0; i < onTrip.length; i++) colors.set(onTrip[i] ? tint.full : tint.dimmed, i * 3)
      r.instanceColor!.needsUpdate = true
      fades.last.fill(NaN)
    }
    const d = cameraDistance(state)
    const reveal = interiorOpacity(d)
    let faded = false
    for (let k = 0; k < fades.index.length; k++) {
      const amount = reveal * fades.presence[k]!.value
      if (amount === fades.last[k]) continue
      fades.last[k] = amount
      const i = fades.index[k]!
      const gone = amount >= 1 ? 1 : 0
      if (gone !== fades.gone[k]) {
        fades.gone[k] = gone
        fades.moved = true
      }
      const base = onTrip[i] || !(t.dim > 0) ? tint.full : tint.dimmed
      ;(r.instanceColor!.array as Float32Array).set(dimLineRgbInto(fades.rgb, base, BACKGROUND, amount), i * 3)
      faded = true
    }
    if (faded) r.instanceColor!.needsUpdate = true
    const scale = screenScale(d, markerRadiusPx(d), MARKER_MIN_METERS)
    const last = drawn.current
    if (scale === last.scale && hidden === last.hidden && !fades.moved) return
    last.scale = scale
    last.hidden = hidden
    fades.moved = false
    // Scale 0 collapses a hidden instance, so neither its fill nor its ring draws; so does a fully faded covered one.
    const matrices = f.instanceMatrix.array as Float32Array
    writeMarkerMatrices(matrices, positions, MARKER_Y, scale, hidden)
    for (let k = 0; k < fades.index.length; k++) {
      if (fades.gone[k] !== 1) continue
      const p = positions[fades.index[k]!]!
      writeInstanceMatrix(matrices, fades.index[k]!, p.x, MARKER_Y, p.z, 0)
    }
    r.instanceMatrix.array.set(f.instanceMatrix.array)
    f.instanceMatrix.needsUpdate = true
    r.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh
        ref={fill}
        args={[geometry.fill, undefined, stations.length]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.stationFill}
      >
        <meshBasicMaterial color={theme.stationFill} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={ring}
        args={[geometry.ring, undefined, stations.length]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.stationRing}
      >
        {/* Default white material: the per-instance colors are the ring colors. */}
        <meshBasicMaterial transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      {focusedMarker && focusedIndex >= 0 && <FocusRing position={stations[focusedIndex]!.pos} tripRole={focusedRole} levels={levels} fix={fix} />}
    </>
  )
}
