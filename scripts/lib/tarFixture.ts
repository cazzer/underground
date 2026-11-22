/** The tests' tile tarballs: a tar writer for a few entries (including hostile ones) and a real tile body. */
import { gzipSync } from 'node:zlib'

export interface FixtureEntry {
  name: string
  body?: Uint8Array
  /** The typeflag character; '0' (a regular file) by default. */
  type?: string
  link?: string
  prefix?: string
  /** `ustar` writes `ustar\0` and version `00` (POSIX, the default); `gnu` writes `ustar  \0` (GNU tar's old format); `none` writes no magic. */
  magic?: 'ustar' | 'gnu' | 'none'
}

/** A small MVT: one layer holding `n` filler bytes (its length a protobuf varint). */
export function tileBody(n = 3): Uint8Array {
  const len = n < 128 ? [n] : [(n & 0x7f) | 0x80, n >> 7]
  return Uint8Array.from([0x1a, ...len, ...new Array<number>(n).fill(0x0a)])
}

function put(block: Uint8Array, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) block[at + i] = text.charCodeAt(i)
}

function header(e: FixtureEntry, size: number): Uint8Array {
  const block = new Uint8Array(512)
  put(block, 0, e.name)
  put(block, 100, '0000644\0')
  put(block, 108, '0000000\0')
  put(block, 116, '0000000\0')
  put(block, 124, `${size.toString(8).padStart(11, '0')}\0`)
  put(block, 136, '00000000000\0')
  put(block, 156, e.type ?? '0')
  put(block, 157, e.link ?? '')
  if (e.magic === 'gnu') put(block, 257, 'ustar  \0')
  else if (e.magic !== 'none') {
    put(block, 257, 'ustar\0')
    put(block, 263, '00')
  }
  put(block, 345, e.prefix ?? '')
  put(block, 148, '        ')
  const sum = block.reduce((s, b) => s + b, 0)
  put(block, 148, `${sum.toString(8).padStart(6, '0')}\0 `)
  return block
}

/** `pad` rounds the archive up to a multiple of that many bytes with zeros, as GNU tar does to its 10240-byte record. */
export function makeTar(entries: FixtureEntry[], { end = true, pad }: { end?: boolean; pad?: number } = {}): Uint8Array {
  const parts: Uint8Array[] = []
  for (const e of entries) {
    const body = e.body ?? new Uint8Array()
    parts.push(header(e, body.length), body, new Uint8Array((512 - (body.length % 512)) % 512))
  }
  if (end) parts.push(new Uint8Array(1024))
  if (pad !== undefined) parts.push(new Uint8Array((pad - (parts.reduce((n, p) => n + p.length, 0) % pad)) % pad))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export function makeTarGz(entries: FixtureEntry[], options: { pad?: number } = {}): Buffer {
  return gzipSync(makeTar(entries, options))
}

/** `tileBody(n)` gzip-compressed, as the workflow's `gzip -n -9` stores a tile (still named .mvt). */
export function gzipTileBody(n = 3): Uint8Array {
  return gzipSync(tileBody(n), { level: 9 })
}
