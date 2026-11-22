/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** The basemap the client may load (vite.config.ts, from data/basemap/basemap.json); null while none is served. */
declare const __BASEMAP__: import('./data/basemapConfig').BasemapConfig | null
