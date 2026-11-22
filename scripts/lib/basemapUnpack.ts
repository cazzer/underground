/** Unpacks the basemap tarball (nyc-tiles.tar.gz) into `<destRoot>/tiles/<z>/<x>/<y>.mvt`.
 *
 *  Everything is checked before the first byte is written: the gzip stream is bounded by the pin's sizes, every tar entry
 *  must be a regular tile file by name (scripts/lib/tarTiles.ts, an allowlist), the file count and total size must be
 *  the pin's, and every body must be an MVT. A name that still resolved outside `destRoot` is refused again at write time. */
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { listTarFiles } from './tarTiles.ts'
import { mvtProblems } from './tileProbe.ts'

export interface UnpackExpect {
  files: number
  tileBytes: number
  /** The deepest zoom a tile may have (the spec's maxzoom). */
  maxZoom: number
}

/** Header and padding take at most 1023 bytes a file, and the archive ends in two blocks. GNU tar also pads the archive to a
 *  multiple of its 10240-byte record, so the limit is rounded up to one and given one more. */
const TAR_OVERHEAD_PER_FILE = 1024
const TAR_END = 1024
const TAR_RECORD = 10240

export async function unpackTarGz(tarGz: string, destRoot: string, expect: UnpackExpect): Promise<{ files: number; bytes: number }> {
  const raw = expect.tileBytes + expect.files * TAR_OVERHEAD_PER_FILE + TAR_END
  const maxOutputLength = Math.ceil(raw / TAR_RECORD) * TAR_RECORD + TAR_RECORD
  let tar: Uint8Array
  try {
    tar = gunzipSync(await readFile(tarGz), { maxOutputLength })
  } catch (err) {
    throw new Error(`${tarGz} is not a gzip of at most ${maxOutputLength} bytes (the pin's ${expect.files} files and ${expect.tileBytes} tile bytes): ${err instanceof Error ? err.message : String(err)}`)
  }
  const files = listTarFiles(tar, expect.maxZoom)
  const bytes = files.reduce((n, f) => n + f.size, 0)
  if (files.length !== expect.files) throw new Error(`the tarball has ${files.length} tile files, the pin says ${expect.files}`)
  if (bytes !== expect.tileBytes) throw new Error(`the tarball's tiles total ${bytes} bytes, the pin says ${expect.tileBytes}`)
  for (const f of files) {
    const problems = mvtProblems(tar.subarray(f.offset, f.offset + f.size))
    if (problems.length > 0) throw new Error(`${f.name} is not an MVT tile: ${problems[0]}`)
  }
  const root = resolve(destRoot)
  const existing = await lstat(resolve(root, 'tiles')).catch((err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? null : Promise.reject(err)))
  if (existing !== null) throw new Error(`${resolve(root, 'tiles')} already exists (a staging dir must be empty; a symlink there would be followed)`)
  for (const f of files) {
    const target = resolve(root, f.name)
    if (!target.startsWith(root + sep)) throw new Error(`${f.name} resolves outside ${root}`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, tar.subarray(f.offset, f.offset + f.size), { flag: 'wx' })
  }
  return { files: files.length, bytes }
}
