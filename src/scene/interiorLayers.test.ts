import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { StationInterior } from '../data/stationSchema'

// theme.ts and interiorLook.ts read window.location on import; tests run in node.
vi.stubGlobal('window', { location: { search: '' } })
const { buildInteriorModel, interiorLayers } = await import('./interiorModel')
vi.unstubAllGlobals()

const l08 = JSON.parse(readFileSync(new URL('../../public/data/stations/L08.json', import.meta.url), 'utf8')) as StationInterior
const model = buildInteriorModel(l08)

/** The distinct segment-end colors of some layers, as strings. */
function colorsOf(...layers: { colors: Float32Array }[]): Set<string> {
  const out = new Set<string>()
  for (const l of layers) for (let i = 0; i < l.colors.length; i += 3) out.add(Array.from(l.colors.subarray(i, i + 3), (v) => v.toFixed(4)).join(','))
  return out
}

describe('interiorLayers', () => {
  it('is the model itself with nothing out, so no outage costs no rebuild', () => {
    expect(interiorLayers(model, '')).toBe(model)
  })

  it('redraws the layers with an outaged elevator, leaving the model untouched', () => {
    const before = [model.strong, model.fine, model.overStrong, model.overFine]
    const out = interiorLayers(model, 'EL358')
    expect(out).not.toBe(model)
    // The two stops' strong diagonals (2 each, 6 floats a segment), split between the layers under and over the trains.
    expect(out.strong.positions.length + out.overStrong.positions.length).toBe(model.strong.positions.length + model.overStrong.positions.length + 4 * 6)
    expect([model.strong, model.fine, model.overStrong, model.overFine]).toEqual(before)
    // The outaged machine adds colors the model never uses (the outage role's, at each level it spans).
    const base = colorsOf(model.strong, model.fine, model.overStrong, model.overFine)
    const redrawn = colorsOf(out.strong, out.fine, out.overStrong, out.overFine)
    expect([...redrawn].filter((c) => !base.has(c)).length).toBeGreaterThan(0)
  })

  it('keeps the model reference-stable: outages never enter it', () => {
    interiorLayers(model, 'EL358,EL359')
    expect(buildInteriorModel(l08).interior).toBe(l08)
    expect(model.interior).toBe(l08)
  })

  it('logs and falls back to the model\'s own layers if a rebuild throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { ...model, interior: { ...l08, connectors: [{ ...l08.connectors[0]!, lower: { x: 0, z: 0, level: 'nowhere' } }] } }
    expect(interiorLayers(broken, 'EL358')).toBe(broken)
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})
