/**
 * Tiles may be stored gzipped (served without Content-Encoding, so fetch hands over the gzip bytes): such a body is
 * inflated with the platform's DecompressionStream before decoding. Raw MVT passes through untouched.
 */

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/** The body itself, or its inflated bytes if it is gzip; rejects on a corrupt gzip stream. */
export async function inflateIfGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
