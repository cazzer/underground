import data from '../data/streetIndex.json'
import { loadStreetIndex } from './streetIndex.ts'

/**
 * The bundled street index, parsed once per isolate at startup. Eager on purpose: startup has its own 1 s limit, while a lazy
 * load would put about 10 ms of parsing into the first /geocode miss and could break the Free plan's 10 ms CPU per request.
 * Only index.ts and its data test import this file: the client must never bundle it (the build is checked for a street name in dist/).
 */
export const STREET_INDEX = loadStreetIndex(data)
