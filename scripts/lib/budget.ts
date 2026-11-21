/** The gzip budget of public/data/*.json (shared by scripts/build-data.ts and scripts/build-access.ts). */
import { gzipSync } from 'node:zlib'

export const GZIP_BUDGET_BYTES = 60_000

export interface RenderedFile {
  name: string
  text: string
  raw: number
  gzip: number
}

export function renderedFile(name: string, text: string): RenderedFile {
  return { name, text, raw: Buffer.byteLength(text), gzip: gzipSync(text, { level: 9 }).length }
}

/** `files` plus the committed `others` (name to gzip bytes) must fit the budget; returns the total. */
export function checkBudget(files: readonly RenderedFile[], others: Readonly<Record<string, number>> = {}): number {
  const sizes = [...files.map((f) => [f.name, f.gzip] as const), ...Object.entries(others)]
  const total = sizes.reduce((sum, [, gzip]) => sum + gzip, 0)
  if (total > GZIP_BUDGET_BYTES) {
    const list = sizes.map(([name, gzip]) => `${name} ${gzip}`).join(', ')
    throw new Error(`Gzipped total ${total} B is over the ${GZIP_BUDGET_BYTES} B budget (${list}). Nothing written.`)
  }
  return total
}
