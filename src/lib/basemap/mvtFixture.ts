/** Tests only: writes a small MVT (vector tile spec 2.1) from plain features, so decoding is tested without real tiles. */
import { PbfWriter } from 'pbf'

export interface FixtureFeature {
  type: 1 | 2 | 3
  props: Record<string, string | number | boolean>
  /** Lines or rings in whole tile units; a ring is written open and closed with ClosePath. */
  parts: [number, number][][]
}

export interface FixtureLayer {
  name: string
  extent?: number
  features: FixtureFeature[]
}

const command = (id: number, count: number) => (id & 7) | (count << 3)
const zigzag = (n: number) => (n << 1) ^ (n >> 31)

function geometry(f: FixtureFeature): number[] {
  const out: number[] = []
  let cx = 0
  let cy = 0
  const move = (p: [number, number]) => {
    out.push(zigzag(p[0] - cx), zigzag(p[1] - cy))
    cx = p[0]
    cy = p[1]
  }
  for (const part of f.parts) {
    out.push(command(1, 1))
    move(part[0]!)
    if (part.length > 1) {
      out.push(command(2, part.length - 1))
      part.slice(1).forEach(move)
    }
    if (f.type === 3) out.push(command(7, 1))
  }
  return out
}

function writeValue(v: string | number | boolean, pbf: PbfWriter): void {
  if (typeof v === 'string') pbf.writeStringField(1, v)
  else if (typeof v === 'boolean') pbf.writeBooleanField(7, v)
  else if (Number.isInteger(v)) pbf.writeSVarintField(6, v)
  else pbf.writeDoubleField(3, v)
}

function writeLayer(layer: FixtureLayer, pbf: PbfWriter): void {
  const keys: string[] = []
  const values: (string | number | boolean)[] = []
  const index = <T,>(list: T[], v: T) => {
    const i = list.indexOf(v)
    return i >= 0 ? i : list.push(v) - 1
  }
  pbf.writeVarintField(15, 2)
  pbf.writeStringField(1, layer.name)
  layer.features.forEach((f, id) => {
    const tags = Object.entries(f.props).flatMap(([k, v]) => [index(keys, k), index(values, v)])
    pbf.writeMessage(
      2,
      (feature: FixtureFeature, w: PbfWriter) => {
        w.writeVarintField(1, id + 1)
        w.writePackedVarint(2, tags)
        w.writeVarintField(3, feature.type)
        w.writePackedVarint(4, geometry(feature))
      },
      f,
    )
  })
  for (const k of keys) pbf.writeStringField(3, k)
  for (const v of values) pbf.writeMessage(4, writeValue, v)
  pbf.writeVarintField(5, layer.extent ?? 4096)
}

export function writeMvt(layers: FixtureLayer[]): Uint8Array {
  const pbf = new PbfWriter()
  for (const layer of layers) pbf.writeMessage(3, writeLayer, layer)
  return pbf.finish()
}
