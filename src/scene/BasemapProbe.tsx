/**
 * Loads basemap tiles without drawing them (the renderer is ost.9.3), so the tile source can be checked under
 * `?debug` in dev: Network panel, `__underground.basemap()` for counts and decode times.
 */
import type { BasemapConfig } from '../data/basemapConfig'
import { useBasemapTiles } from './useBasemapTiles'

interface BasemapProbeProps {
  config: BasemapConfig
}

export function BasemapProbe({ config }: BasemapProbeProps) {
  useBasemapTiles(config)
  return null
}
