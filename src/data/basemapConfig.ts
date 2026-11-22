/**
 * The basemap the client may load: the spec's bbox, max zoom and kept layers plus the pin's release tag, set at
 * build time from data/basemap/basemap.json (vite.config.ts). Null while no tile directory is served: then
 * nothing loads.
 */
export interface BasemapConfig {
  bbox: [number, number, number, number]
  maxzoom: number
  layers: string[]
  /** The pin's release tag: in every tile URL, so a new build never reads an old cached tile. */
  version: string
}

export const BASEMAP: BasemapConfig | null = __BASEMAP__

/**
 * Same-origin tile path: `public/basemap/tiles/` in dev, the Pages artifact's `basemap/tiles/` when deployed. The
 * worker resolves it against its own (same-origin) URL.
 */
export function tileUrl(config: BasemapConfig, z: number, x: number, y: number): string {
  return `${import.meta.env.BASE_URL}basemap/tiles/${z}/${x}/${y}.mvt?v=${encodeURIComponent(config.version)}`
}
