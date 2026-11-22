/** What a static host must answer for one basemap tile, and what a tile must be. Pure: scripts/verify-basemap.ts makes
 *  the requests, scripts/lib/tileTree.ts reads the files, and both call this on the bytes. */

export interface TileCoord {
  z: number
  x: number
  y: number
}

export interface ProbeTile extends TileCoord {
  label: string
}

/** The XYZ (y down from the north) tile holding a point at zoom `z`. */
export function lonLatToTile(lon: number, lat: number, z: number): TileCoord {
  const n = 2 ** z
  const rad = (lat * Math.PI) / 180
  const x = Math.floor(((lon + 180) / 360) * n)
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) }
}

export function tilePath({ z, x, y }: TileCoord): string {
  return `${z}/${x}/${y}.mvt`
}

/** The tiles the deploy probes: the world tile, and a z15 tile over Midtown and over Brooklyn (each holds roads and land). */
export const PROBE_TILES: readonly ProbeTile[] = [
  { label: 'z0 world', z: 0, x: 0, y: 0 },
  { label: 'z15 Midtown (Times Sq)', ...lonLatToTile(-73.9855, 40.758, 15) },
  { label: 'z15 Brooklyn (Prospect Park)', ...lonLatToTile(-73.9692, 40.6602, 15) },
]

/** A tile the pack never holds (the north-west corner of the world at z15): the site must answer 404, which the client
 *  treats as an empty tile. Informational: it is recorded, never a failure. */
export const MISSING_TILE: ProbeTile = { label: 'z15 absent tile', z: 15, x: 0, y: 0 }

function varint(body: Uint8Array, at: number): { value: number; next: number } | null {
  let value = 0
  let shift = 1
  for (let i = at; i < body.length && i < at + 5; i++) {
    const b = body[i] as number
    value += (b & 0x7f) * shift
    if (b < 0x80) return { value, next: i + 1 }
    shift *= 128
  }
  return null
}

/** Every way `body` is not a Mapbox Vector Tile: the top level of the protobuf must be nothing but `layers` (field 3,
 *  length-delimited, tag 0x1a) that run exactly to the end, and there must be at least one. Empty when it is one. */
export function mvtProblems(body: Uint8Array): string[] {
  if (body.length === 0) return ['empty body']
  let at = 0
  let layers = 0
  while (at < body.length) {
    if (body[at] !== 0x1a) return [`byte ${at} is 0x${(body[at] as number).toString(16)}, not a layer tag (0x1a): not an MVT (compressed?)`]
    const len = varint(body, at + 1)
    if (len === null) return [`bad layer length at byte ${at + 1}`]
    at = len.next + len.value
    layers++
  }
  if (at !== body.length) return [`the layers end at byte ${at}, the body at ${body.length}`]
  return layers > 0 ? [] : ['no layers']
}

export interface ProbeResponse {
  status: number
  /** Header names lowercased. */
  headers: Readonly<Record<string, string>>
  /** The body as the client reads it, after any content-encoding was decoded. */
  body?: Uint8Array
}

export interface TileExpect {
  /** The tile file's size in the deployed tree; the decoded body must have it. */
  size: number
  /** When `identity`, the response must not be content-encoded; otherwise any encoding is fine (the browser decodes it). */
  encoding: 'identity' | 'any'
  /** The identity body: a decoded body must equal it byte for byte. */
  reference?: Uint8Array
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Every way the response is not a 200 with the tile's exact bytes. Empty when it is. */
export function tileProblems(expect: TileExpect, res: ProbeResponse): string[] {
  const problems: string[] = []
  if (res.status !== 200) problems.push(`status ${res.status}, not 200`)
  const encoding = res.headers['content-encoding']
  if (expect.encoding === 'identity' && encoding !== undefined && encoding !== 'identity') problems.push(`content-encoding ${encoding} on an identity request`)
  const { body } = res
  if (body === undefined) return [...problems, 'no body read']
  if (res.status === 200) {
    if (body.length !== expect.size) problems.push(`body is ${body.length} bytes, the file is ${expect.size}`)
    const mvt = mvtProblems(body)
    if (mvt.length > 0) problems.push(...mvt)
    else if (expect.reference !== undefined && !sameBytes(body, expect.reference)) problems.push('the decoded body differs from the identity body')
  }
  return problems
}
