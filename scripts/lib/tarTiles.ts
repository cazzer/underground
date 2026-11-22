/** A reader for the basemap's tile tarball (`tiles/<z>/<x>/<y>.mvt`, ustar, regular files only), strict on purpose.
 *
 *  It is our own reader, not the system `tar`, so that nothing is written before every entry was checked and so that
 *  one rule decides what may land on disk, the same on a Mac and on the runner (bsdtar and GNU tar differ on links,
 *  absolute names and `..`). It is an allowlist: an entry is accepted only if its name is exactly a tile path of
 *  the form below and its type is a regular file, which leaves no room for an absolute path, `..`, a backslash, a
 *  symlink, a hard link, a device, a directory entry, a pax or GNU long-name extension, or a name outside `tiles/`.
 *  Pure: it takes the decompressed bytes. */

export interface TarFile {
  /** The tile path, `tiles/<z>/<x>/<y>.mvt`. */
  name: string
  size: number
  /** Where the file's bytes start in the archive. */
  offset: number
}

const BLOCK = 512
const NAME = /^tiles\/(0|[1-9]\d?)\/(0|[1-9]\d{0,7})\/(0|[1-9]\d{0,7})\.mvt$/
export const MAX_TILE_ZOOM = 22
/** Bytes 257 to 264 of a header: the magic `ustar\0` and the version `00`. */
const USTAR = [0x75, 0x73, 0x74, 0x61, 0x72, 0x00, 0x30, 0x30]

/** null when `name` is exactly a tile path of a real tile (x and y inside the zoom's grid), else why not. */
export function tileNameProblem(name: string, maxZoom = MAX_TILE_ZOOM): string | null {
  const m = NAME.exec(name)
  if (m === null) return `${JSON.stringify(name)} is not tiles/<z>/<x>/<y>.mvt`
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (z > maxZoom) return `${name}: zoom ${z} is over ${maxZoom}`
  if (x >= 2 ** z || y >= 2 ** z) return `${name}: x or y is outside the zoom ${z} grid`
  return null
}

function field(block: Uint8Array, from: number, to: number): Uint8Array {
  return block.subarray(from, to)
}

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  return String.fromCharCode(...(end < 0 ? bytes : bytes.subarray(0, end)))
}

function octal(bytes: Uint8Array, what: string): number {
  if (((bytes[0] as number) & 0x80) !== 0) throw new Error(`tar: ${what} uses the base-256 extension`)
  const s = cString(bytes).trim()
  if (!/^[0-7]+$/.test(s)) throw new Error(`tar: ${what} ${JSON.stringify(s)} is not octal`)
  return parseInt(s, 8)
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0)
}

function checksum(block: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (block[i] as number)
  return sum
}

/** The files of an uncompressed tar, in archive order. Throws, naming the entry, on anything but regular tile files. */
export function listTarFiles(tar: Uint8Array, maxZoom = MAX_TILE_ZOOM): TarFile[] {
  const files: TarFile[] = []
  const seen = new Set<string>()
  let pos = 0
  for (;;) {
    if (pos + BLOCK > tar.length) throw new Error('tar: truncated, no end-of-archive block')
    const block = tar.subarray(pos, pos + BLOCK)
    if (isZero(block)) {
      if (!isZero(tar.subarray(pos))) throw new Error('tar: data after the end-of-archive block')
      return files
    }
    const name = cString(field(block, 0, 100))
    const bad = (why: string): Error => new Error(`tar entry ${JSON.stringify(name)}: ${why}`)
    if (octal(field(block, 148, 156), 'the checksum') !== checksum(block)) throw bad('bad header checksum')
    if (!USTAR.every((b, i) => block[257 + i] === b)) throw bad('not a POSIX ustar header (magic "ustar\\0", version "00"; GNU tar needs --format=ustar)')
    const type = block[156] as number
    if (type !== 0x30 && type !== 0) throw bad(`type ${JSON.stringify(String.fromCharCode(type))} is not a regular file (links, directories, devices and extensions are refused)`)
    if (cString(field(block, 157, 257)) !== '' || cString(field(block, 345, 500)) !== '') throw bad('has a link name or a name prefix')
    const problem = tileNameProblem(name, maxZoom)
    if (problem !== null) throw bad(problem)
    if (seen.has(name)) throw bad('appears twice')
    seen.add(name)
    const size = octal(field(block, 124, 136), 'the size')
    const offset = pos + BLOCK
    const next = offset + Math.ceil(size / BLOCK) * BLOCK
    if (next > tar.length) throw bad('its data runs past the end of the archive')
    files.push({ name, size, offset })
    pos = next
  }
}
