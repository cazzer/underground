import data from '../data/streetIndex.json'
import { loadStreetIndex } from './streetIndex.ts'

/**
 * The bundled street index, parsed once per isolate. Only index.ts and its data test import this file: the client must
 * never bundle it (the build is checked for a street name in dist/).
 */
export const STREET_INDEX = loadStreetIndex(data)
