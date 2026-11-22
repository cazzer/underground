/**
 * Tiles may be stored gzipped (served without Content-Encoding, so fetch hands over the gzip bytes): such a body is
 * inflated with the platform's DecompressionStream before decoding. Raw MVT passes through untouched.
 */

/** The most a tile may inflate to (scripts/lib/tileProbe.ts caps the build at the same number; the largest real tile is
 *  about 90 KB). A stream past it is cancelled, so a bomb never fills the worker's memory. */
export const MAX_INFLATED_BYTES = 2 * 1024 * 1024

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/** The body itself, or its inflated bytes if it is gzip; rejects on a corrupt gzip stream or one that inflates past the cap. */
export async function inflateIfGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_INFLATED_BYTES) {
      await reader.cancel()
      throw new Error(`inflates past ${MAX_INFLATED_BYTES} bytes`)
    }
    chunks.push(value)
  }
  if (chunks.length === 1) return chunks[0] as Uint8Array
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}
