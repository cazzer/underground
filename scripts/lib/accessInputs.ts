/** Reads the committed inputs of `addAccess` (the pinned catalog and the exceptions). IO, used by
 *  scripts/build-data.ts and scripts/build-access.ts. */
import { readFileSync } from 'node:fs'
import type { CatalogStation, SodaHeader } from './catalogTypes.ts'
import { parseAccessExceptions, type AccessExceptions } from './accessExceptions.ts'

const CATALOG_STATIONS = new URL('../../data/stations/catalog/stations.json', import.meta.url)
const EXCEPTIONS = new URL('../../data/stations/access-exceptions.json', import.meta.url)

export function readCatalogStations(): CatalogStation[] {
  const catalog = JSON.parse(readFileSync(CATALOG_STATIONS, 'utf8')) as Partial<SodaHeader> & { rows?: unknown }
  if (catalog.dataset !== '39hk-dx4f' || !Array.isArray(catalog.rows)) {
    throw new Error('data/stations/catalog/stations.json is not the 39hk-dx4f catalog (run npm run data:catalog:fetch)')
  }
  return catalog.rows as CatalogStation[]
}

export function readAccessExceptions(): AccessExceptions {
  return parseAccessExceptions(JSON.parse(readFileSync(EXCEPTIONS, 'utf8')))
}
