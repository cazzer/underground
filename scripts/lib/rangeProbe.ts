/** What a static host must answer for the PMTiles client to read the basemap with HTTP Range requests.
 *  Pure: scripts/verify-basemap.ts makes the requests and calls this on what came back. */

export interface ByteRange {
  start: number
  end: number
}

export interface ProbeResponse {
  status: number
  /** Header names lowercased. */
  headers: Readonly<Record<string, string>>
  /** The body, read only when the request asked for `Accept-Encoding: identity`. */
  body?: Uint8Array
}

/** The first and the last `length` bytes of a `total`-byte file: the header and directory a PMTiles client reads first, and the tail a tile may sit in. */
export function probeRanges(total: number, length = 127): ByteRange[] {
  if (!Number.isInteger(total) || total < length) throw new Error(`a ${total}-byte file is too small to probe`)
  return [
    { start: 0, end: length - 1 },
    { start: total - length, end: total - 1 },
  ]
}

const MAGIC = [0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73] // "PMTiles"
const SPEC_VERSION = 3

/** Every way the response is not a correct, uncompressed 206 for `range` of a `total`-byte file; empty when it is. */
export function rangeProblems(range: ByteRange, total: number, res: ProbeResponse): string[] {
  const problems: string[] = []
  if (res.status !== 206) problems.push(`status ${res.status}, not 206`)
  const expectedRange = `bytes ${range.start}-${range.end}/${total}`
  const contentRange = res.headers['content-range']
  if (contentRange !== expectedRange) problems.push(`content-range ${contentRange === undefined ? 'missing' : `"${contentRange}"`}, not "${expectedRange}"`)
  const encoding = res.headers['content-encoding']
  if (encoding !== undefined && encoding !== 'identity') problems.push(`content-encoding ${encoding}: the range is compressed`)
  const { body } = res
  if (body !== undefined) {
    const length = range.end - range.start + 1
    if (body.length !== length) problems.push(`body is ${body.length} bytes, not ${length}`)
    if (range.start === 0) {
      if (!MAGIC.every((b, i) => body[i] === b)) problems.push('body does not start with "PMTiles"')
      else if (body[MAGIC.length] !== SPEC_VERSION) problems.push(`PMTiles spec version ${body[MAGIC.length]}, not ${SPEC_VERSION}`)
    }
  }
  return problems
}
