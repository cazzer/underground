import { EQUIPMENT_FORMAT, type EquipmentIndexFile } from './equipmentSchema'
import { fetchJson } from './loadNetwork'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Checks the shape of a fetched stations/equipment.json: the format, every machine's kind and text, and that each station lists only known machines. */
export function expectEquipmentIndex(raw: unknown, url: string): EquipmentIndexFile {
  const fail = (why: string) => new Error(`${url}: not an equipment index (${why})`)
  if (!isRecord(raw)) throw fail('not an object')
  if (raw.format !== EQUIPMENT_FORMAT) throw fail(`format is ${JSON.stringify(raw.format)}, not ${EQUIPMENT_FORMAT}`)
  const { machines, stations } = raw
  if (!isRecord(machines)) throw fail('no machines object')
  if (!isRecord(stations)) throw fail('no stations object')
  for (const [code, machine] of Object.entries(machines)) {
    if (!isRecord(machine) || (machine.kind !== 'elevator' && machine.kind !== 'escalator')) throw fail(`machine ${code} has no valid kind`)
    if (machine.serving !== null && typeof machine.serving !== 'string') throw fail(`machine ${code} has a serving that is neither text nor null`)
  }
  for (const [id, codes] of Object.entries(stations)) {
    if (!Array.isArray(codes)) throw fail(`station ${id} is not a list`)
    for (const code of codes) {
      if (typeof code !== 'string' || !Object.hasOwn(machines, code)) throw fail(`station ${id} lists unknown machine ${String(code)}`)
    }
  }
  return raw as unknown as EquipmentIndexFile
}

/** Fetches `<baseUrl>data/stations/equipment.json`: every elevator and escalator by code, and the codes at each station. */
export async function loadEquipmentIndex(baseUrl: string): Promise<EquipmentIndexFile> {
  const url = `${baseUrl}data/stations/equipment.json`
  return expectEquipmentIndex(await fetchJson(url), url)
}
