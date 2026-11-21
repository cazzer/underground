import { useEffect, useMemo, type Ref } from 'react'
import { PlaneGeometry, Shape, ShapeGeometry, Vector2, type Mesh } from 'three'
import type { LocalPoint } from '../data/stationSchema'
import { theme } from '../theme'
import { RENDER_ORDER } from './renderOrder'

/** Meters per side: the view at the reveal's far end (320 m) spans well under a kilometer. */
const SCREEN_VEIL_SIZE = 4000

interface InteriorVeilProps {
  /** null: a screen-wide plane (look A); otherwise the cutaway outline, group-local (look B). */
  hull: LocalPoint[] | null
  ref: Ref<Mesh>
}

/**
 * Background-colored plane drawn after the street layers and before the interior, so it dims
 * the grid, lines, stations and trains in one draw call. StationInterior drives its opacity.
 * It has no pointer handlers, so it is never raycast and station clicks pass through.
 */
export function InteriorVeil({ hull, ref }: InteriorVeilProps) {
  const geometry = useMemo(() => {
    if (!hull) return new PlaneGeometry(SCREEN_VEIL_SIZE, SCREEN_VEIL_SIZE).rotateX(-Math.PI / 2)
    // rotateX(-π/2) maps shape y to scene -z, so shape points are (x, -z).
    return new ShapeGeometry(new Shape(hull.map(([x, z]) => new Vector2(x, -z)))).rotateX(-Math.PI / 2)
  }, [hull])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh ref={ref} geometry={geometry} renderOrder={RENDER_ORDER.interiorVeil}>
      <meshBasicMaterial color={theme.background} transparent opacity={0} depthTest={false} depthWrite={false} />
    </mesh>
  )
}
