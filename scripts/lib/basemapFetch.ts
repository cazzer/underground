/** Puts the pinned basemap file at a path: reused if it already matches the pin, else downloaded to `<path>.tmp`,
 *  checked (size and sha256) and renamed, so a half-written or tampered file never sits at the path. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BasemapPin } from './basemapSpec.ts'

export interface EnsureDeps {
  /** Writes the body of `url` to `toPath`; throws on any non-success. */
  download(url: string, toPath: string): Promise<void>
}

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** null when the file matches the pin, else why it doesn't (missing, wrong size, wrong hash). */
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

export async function ensureBasemap(pin: BasemapPin, url: string, out: string, deps: EnsureDeps): Promise<'present' | 'downloaded'> {
  if ((await mismatch(out, pin)) === null) return 'present'
  const tmp = `${out}.tmp`
  await mkdir(dirname(out), { recursive: true })
  await rm(tmp, { force: true })
  try {
    await deps.download(url, tmp)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
  const bad = await mismatch(tmp, pin)
  if (bad !== null) {
    await rm(tmp, { force: true })
    throw new Error(`${url} does not match the pin in data/basemap/basemap.json (${bad}); it was not kept`)
  }
  await rename(tmp, out)
  return 'downloaded'
}
