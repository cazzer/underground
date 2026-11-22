/** data/basemap/basemap.json: what the basemap workflow extracts (`spec`) and the published build the site serves (`pin`).
 *  The pin is null until the first publish; a normal PR then sets it, so CI runs on it. The release asset is a tarball of
 *  uncompressed MVT tiles, `tiles/<z>/<x>/<y>.mvt`, which deploy.yml extracts into the Pages artifact (the site reads no
 *  Range). A pin from before that (the single `nyc.pmtiles` asset, no `asset` key) parses as `LegacyPin` and is not deployed. */
import { finite, list, oneOf, onlyKeys, record, text } from './check.ts'

export const REPO = 'cazzer/underground'
export const BASEMAP_ASSET = 'nyc-tiles.tar.gz'

/** The Protomaps layers this site can use without new credits; the others carry ESA WorldCover (CC BY 4.0) or Tilezen terms, or are of no use here. */
export const KNOWN_LAYERS = ['boundaries', 'buildings', 'earth', 'landcover', 'landuse', 'places', 'pois', 'roads', 'water'] as const

export interface BasemapSpec {
  bbox: [number, number, number, number]
  maxzoom: number
  layers: string[]
  dropLayers: string[]
}

export interface PinBase {
  /** The Protomaps daily build the extract was cut from, e.g. 20261121. */
  build: string
  /** The `version` of that build's metadata (the basemap schema version, e.g. 4.15.2). */
  basemapVersion: string
  /** The GitHub Release tag holding the asset. */
  release: string
  /** The asset's sha256 and size. */
  sha256: string
  bytes: number
}

export interface BasemapPin extends PinBase {
  asset: typeof BASEMAP_ASSET
  /** The tile files in the tarball, and the sum of their sizes once unpacked: what the deploy checks after extracting. */
  files: number
  tileBytes: number
}

/** The first pin format: the whole archive as one `nyc.pmtiles` asset. Kept parsing so main stays deployable until the new release is pinned. */
export interface LegacyPin extends PinBase {
  legacy: true
}

export interface BasemapFile {
  spec: BasemapSpec
  pin: BasemapPin | LegacyPin | null
}

function layerNames(v: unknown, path: string): string[] {
  const names = list(v, path).map((x, i) => oneOf(x, KNOWN_LAYERS, `${path}[${i}]`))
  if (new Set(names).size !== names.length) throw new Error(`${path}: duplicate layer`)
  return names
}

function parseSpec(v: unknown): BasemapSpec {
  const s = record(v, 'basemap.spec')
  onlyKeys(s, ['bbox', 'maxzoom', 'layers', 'dropLayers'], 'basemap.spec')
  const raw = list(s.bbox, 'basemap.spec.bbox')
  if (raw.length !== 4) throw new Error('basemap.spec.bbox: expected [west, south, east, north]')
  const [west, south, east, north] = raw.map((x, i) => finite(x, `basemap.spec.bbox[${i}]`)) as [number, number, number, number]
  if (!(west < east && south < north && west >= -180 && east <= 180 && south >= -90 && north <= 90)) {
    throw new Error(`basemap.spec.bbox: not a valid west < east, south < north box: ${JSON.stringify(raw)}`)
  }
  const maxzoom = finite(s.maxzoom, 'basemap.spec.maxzoom')
  if (!Number.isInteger(maxzoom) || maxzoom < 0 || maxzoom > 15) throw new Error(`basemap.spec.maxzoom: expected an integer 0 to 15, got ${maxzoom}`)
  const layers = layerNames(s.layers, 'basemap.spec.layers')
  const dropLayers = layerNames(s.dropLayers, 'basemap.spec.dropLayers')
  const both = layers.filter((l) => dropLayers.includes(l))
  if (both.length > 0) throw new Error(`basemap.spec: ${both.join(', ')} is both kept and dropped`)
  const missing = KNOWN_LAYERS.filter((l) => !layers.includes(l) && !dropLayers.includes(l))
  if (missing.length > 0) throw new Error(`basemap.spec: ${missing.join(', ')} is neither kept nor dropped`)
  return { bbox: [west, south, east, north], maxzoom, layers, dropLayers }
}

function positiveInt(v: unknown, path: string): number {
  const n = finite(v, path)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${path}: expected a positive integer, got ${n}`)
  return n
}

function parsePin(v: unknown): BasemapPin | LegacyPin | null {
  if (v === null) return null
  const p = record(v, 'basemap.pin')
  const legacy = p.asset === undefined
  onlyKeys(p, legacy ? ['build', 'basemapVersion', 'release', 'sha256', 'bytes'] : ['build', 'basemapVersion', 'release', 'asset', 'sha256', 'bytes', 'files', 'tileBytes'], 'basemap.pin')
  const build = text(p.build, 'basemap.pin.build')
  if (!/^\d{8}$/.test(build)) throw new Error(`basemap.pin.build: expected YYYYMMDD, got ${build}`)
  const sha256 = text(p.sha256, 'basemap.pin.sha256')
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`basemap.pin.sha256: expected 64 lowercase hex digits, got ${sha256}`)
  const release = text(p.release, 'basemap.pin.release')
  if (!/^basemap-\d{8}-[0-9a-f]{8}$/.test(release)) throw new Error(`basemap.pin.release: expected basemap-<build>-<sha8>, got ${release}`)
  if (release !== releaseTag(build, sha256)) throw new Error(`basemap.pin.release ${release} does not match build ${build} and sha256 ${sha256.slice(0, 8)}`)
  const base: PinBase = { build, basemapVersion: text(p.basemapVersion, 'basemap.pin.basemapVersion'), release, sha256, bytes: positiveInt(p.bytes, 'basemap.pin.bytes') }
  if (legacy) return { ...base, legacy: true }
  if (p.asset !== BASEMAP_ASSET) throw new Error(`basemap.pin.asset: expected ${BASEMAP_ASSET}, got ${JSON.stringify(p.asset)}`)
  return { ...base, asset: BASEMAP_ASSET, files: positiveInt(p.files, 'basemap.pin.files'), tileBytes: positiveInt(p.tileBytes, 'basemap.pin.tileBytes') }
}

export function parseBasemapFile(json: unknown): BasemapFile {
  const root = record(json, 'basemap.json')
  onlyKeys(root, ['spec', 'pin'], 'basemap.json')
  return { spec: parseSpec(root.spec), pin: parsePin(root.pin) }
}

export function releaseAssetUrl(pin: BasemapPin): string {
  return `https://github.com/${REPO}/releases/download/${pin.release}/${pin.asset}`
}

/** The release tag a publish creates: the source build plus the first 8 hex digits of the asset's sha256. */
export function releaseTag(build: string, sha256: string): string {
  return `basemap-${build}-${sha256.slice(0, 8)}`
}
