/** Puts the pinned basemap tile tree at `<outDir>/tiles`: reused if it already is the pin's, else the tarball is downloaded
 *  to a temp dir, checked (size and sha256), unpacked into a staging dir (scripts/lib/basemapUnpack.ts) and renamed
 *  into place, so a half-written or tampered tree never sits at the path. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { unpackTarGz } from './basemapUnpack.ts'
import type { BasemapPin } from './basemapSpec.ts'
import { scanProblems, scanTiles } from './tileTree.ts'

export interface EnsureDeps {
  /** Writes the body of `url` to `toPath`, stopping with an error past `maxBytes`; throws on any non-success. */
  download(url: string, toPath: string, maxBytes: number): Promise<void>
}

/** Holds the tarball's sha256 once its tree was unpacked and checked, next to `tiles/` (never inside it). */
export const MARKER = '.tiles-sha256'
const STAGE = '.tiles-stage'

/** A pass-through that fails the stream once more than `maxBytes` have gone by, so a wrong or runaway download stops early. */
export function byteLimit(maxBytes: number): Transform {
  let seen = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length
      if (seen > maxBytes) callback(new Error(`the download passed ${maxBytes} bytes, the size in the pin`))
      else callback(null, chunk)
    },
  })
}

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** null when the file matches the pin's size and sha256, else why it doesn't (missing, wrong size, wrong hash). */
export async function mismatch(path: string, pin: BasemapPin): Promise<string | null> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw err
  }
  if (size !== pin.bytes) return `${size} bytes, the pin says ${pin.bytes}`
  const sha = await sha256OfFile(path)
  return sha === pin.sha256 ? null : `sha256 ${sha}, the pin says ${pin.sha256}`
}

export interface EnsureResult {
  status: 'present' | 'downloaded'
  downloadMs: number
  extractMs: number
}

async function markerIs(outDir: string, sha256: string): Promise<boolean> {
  try {
    return (await readFile(join(outDir, MARKER), 'utf8')).trim() === sha256
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

export async function ensureTiles(pin: BasemapPin, url: string, outDir: string, maxZoom: number, deps: EnsureDeps): Promise<EnsureResult> {
  const tiles = join(outDir, 'tiles')
  if ((await markerIs(outDir, pin.sha256)) && scanProblems(await scanTiles(tiles, { maxZoom }), pin).length === 0) {
    return { status: 'present', downloadMs: 0, extractMs: 0 }
  }
  await mkdir(outDir, { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'basemap-'))
  const stage = join(outDir, STAGE)
  try {
    const tarball = join(work, pin.asset)
    const downloadStart = performance.now()
    await deps.download(url, tarball, pin.bytes)
    const downloadMs = performance.now() - downloadStart
    const bad = await mismatch(tarball, pin)
    if (bad !== null) throw new Error(`${url} does not match the pin in data/basemap/basemap.json (${bad}); it was not kept`)
    const extractStart = performance.now()
    await rm(stage, { recursive: true, force: true })
    await unpackTarGz(tarball, stage, { files: pin.files, tileBytes: pin.tileBytes, maxZoom })
    await rm(join(outDir, MARKER), { force: true })
    await rm(tiles, { recursive: true, force: true })
    await rename(join(stage, 'tiles'), tiles)
    await writeFile(join(outDir, MARKER), `${pin.sha256}\n`)
    return { status: 'downloaded', downloadMs, extractMs: performance.now() - extractStart }
  } finally {
    await rm(stage, { recursive: true, force: true })
    await rm(work, { recursive: true, force: true })
  }
}
