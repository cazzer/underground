import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CircleGeometry, MeshBasicMaterial, RingGeometry, type Group, type Mesh } from 'three'
import { interiorOpacity } from '../lib/interiorReveal'
import { mixHex } from '../lib/routeColor'
import type { Ground } from '../lib/projection'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { theme } from '../theme'
import { writeLineDim } from './bandLineMaterial'
import { cameraDistance, screenScale } from './cameraDistance'
import { DOT_RADIUS, HALO_INNER, HALO_OUTER, pinOutlineBuffers } from './placePinShape'
import { RENDER_ORDER } from './renderOrder'
import { useLineLayer } from './useLineLayer'

/** How a trip's pin follows the route view (TripPlacePins): the shown look written by SubwayLines, and whether the veil is up. */
export interface TripPinLook {
  levels: EmphasisLevels
  /** The focused interior is loaded under the screen veil: the pin draws above it while it reveals (as the trip's walks do). */
  overVeil: boolean
}

interface PlacePinProps {
  /** The searched place's ground point (the user's pick, never the location fix). */
  ground: Ground
  /** Given, the pin is a trip's: it fades, dims and goes above the veil with the trip's walks. Left out, it is the place line's own. */
  trip?: TripPinLook
}

/**
 * The pin's radius on screen, and the smallest it gets in meters when zoomed right in. The floor sits under the size
 * the radius gives at the closest street-zoom distance (400 m: 2.6 m), so the pin holds its screen size from the
 * place's 600 m landing in, and only below about 125 m stops shrinking.
 */
const PIN_PX = 8
const PIN_MIN_METERS = 1
const Y_PIN = 0.35

/**
 * The pin on a searched place (or street, or intersection): a diamond outline and dot in `theme.placePin` inside a thin
 * background-colored halo band, constant size on screen like the location reticle. The place line's pin is mounted only
 * while the line shows; a trip's (`trip`) while the trip route does, and then everything a frame writes (visibility,
 * opacity, the faint dim, the render orders) is written imperatively, not declared (o3r.9: pins sit in a keyed list).
 * No event handlers, so it never takes a pick.
 */
export function PlacePin({ ground, trip }: PlacePinProps) {
  const pin = useRef<Group>(null)
  const haloMesh = useRef<Mesh>(null)
  const dotMesh = useRef<Mesh>(null)
  const drawn = useRef(NaN)
  const look = useRef<{ opacity: number; dim: number; over: boolean | null }>({ opacity: NaN, dim: NaN, over: null })
  // A ring of four segments is a diamond band, corners on the axes.
  const halo = useMemo(() => new RingGeometry(HALO_INNER, HALO_OUTER, 4).rotateX(-Math.PI / 2), [])
  const dot = useMemo(() => new CircleGeometry(DOT_RADIUS, 24).rotateX(-Math.PI / 2), [])
  const haloMaterial = useMemo(() => new MeshBasicMaterial({ color: theme.background, transparent: true, depthTest: false, depthWrite: false }), [])
  const dotMaterial = useMemo(() => new MeshBasicMaterial({ color: theme.placePin, transparent: true, depthTest: false, depthWrite: false }), [])
  const outlineBuffers = useMemo(() => pinOutlineBuffers(theme.placePin), [])
  const outline = useLineLayer(outlineBuffers, RENDER_ORDER.placePin, theme.placePinWidth, undefined, { dimmable: true })

  useEffect(
    () => () => {
      halo.dispose()
      dot.dispose()
      haloMaterial.dispose()
      dotMaterial.dispose()
    },
    [halo, dot, haloMaterial, dotMaterial],
  )

  useFrame((state) => {
    const g = pin.current
    if (!g) return
    const distance = cameraDistance(state)
    const s = screenScale(distance, PIN_PX, PIN_MIN_METERS)
    if (s !== drawn.current) {
      drawn.current = s
      g.scale.setScalar(s)
    }
    if (!trip) return
    const { levels } = trip
    g.visible = levels.tripVisible
    if (!levels.tripVisible) return
    const l = look.current
    if (l.opacity !== levels.tripOpacity) {
      l.opacity = levels.tripOpacity
      haloMaterial.opacity = l.opacity
      dotMaterial.opacity = l.opacity
      if (outline) outline.material.opacity = l.opacity
    }
    if (l.dim !== levels.tripDim) {
      l.dim = levels.tripDim
      dotMaterial.color.set(mixHex(theme.placePin, theme.background, l.dim))
      if (outline) writeLineDim(outline.material, l.dim)
    }
    const over = trip.overVeil && interiorOpacity(distance) > 0
    if (l.over !== over) {
      l.over = over
      if (haloMesh.current) haloMesh.current.renderOrder = over ? RENDER_ORDER.tripPlacePinHaloOver : RENDER_ORDER.placePinHalo
      if (dotMesh.current) dotMesh.current.renderOrder = over ? RENDER_ORDER.tripPlacePinOver : RENDER_ORDER.placePin
      if (outline) outline.renderOrder = over ? RENDER_ORDER.tripPlacePinOver : RENDER_ORDER.placePin
    }
  })

  // A trip's pin takes its orders from the frame; the place line's own pin has fixed ones.
  return (
    <group ref={pin} position={[ground.x, Y_PIN, ground.z]}>
      <mesh ref={haloMesh} geometry={halo} material={haloMaterial} renderOrder={trip ? undefined : RENDER_ORDER.placePinHalo} />
      <mesh ref={dotMesh} geometry={dot} material={dotMaterial} renderOrder={trip ? undefined : RENDER_ORDER.placePin} />
      {outline && <primitive object={outline} />}
    </group>
  )
}
