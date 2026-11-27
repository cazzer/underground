/**
 * TEMPORARY until the basemap's look is signed off (ost.9.3's review): `?basemap=off` draws the map without it (and
 * loads no tiles), for side-by-side comparison and perf checks. Once decided, remove together:
 * - this file
 * - Scene.tsx: the `basemapLook` import and the `basemapConfig` switch (use BASEMAP directly)
 * - AGENTS.md: `?basemap=off` in the TEMPORARY query flags bullet (Hard rules)
 */
export type BasemapLook = 'on' | 'off'

export function resolveBasemapLook(search: string): BasemapLook {
  return new URLSearchParams(search).get('basemap') === 'off' ? 'off' : 'on'
}

export const basemapLook: BasemapLook = resolveBasemapLook(window.location.search)
