import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import type { EntranceLabelSource } from '../data/useStationStreets'
import { createLabelBlockers } from '../lib/labelBlockers'
import { createLabelPlacement, FIXED_RECTS, newView } from './labelPlacementState'

// The placement module reads the TEMPORARY look flags from window.location on import; tests run in node.
vi.stubGlobal('window', { location: { search: '' } })
const { exemptExitFromMarks, placeLabels } = await import('./streetLabelPlacement')
vi.unstubAllGlobals()

function entrance(index: number, members = [index]): EntranceLabelSource {
  return { index, x: 0, z: 0, head: `E${index}`, tail: '', text: `E${index}`, spoken: `E${index}`, count: members.length, members, elevator: false, unique: true, keys: [], headHouse: 0, streets: [] }
}

describe('exemptExitFromMarks', () => {
  const marks = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }]
  const stations = [{ x: 50, z: 0 }, { x: 60, z: 0 }]

  function exempt(priority: number): Uint32Array {
    const p = createLabelPlacement([entrance(4), entrance(7, [7, 9])], [], marks, stations, [])
    const view = newView(null as unknown as PerspectiveCamera, 1.25)
    view.priorityEntrance = priority
    p.bounds.exempt!.fill(0)
    exemptExitFromMarks(p, view)
    return p.bounds.exempt!
  }

  it('clears only the entrance-mark rects, for the exit label alone', () => {
    // Found through a merged twin: entrance 9 is a member of the second label.
    const bits = exempt(9)
    bits.forEach((b, k) => {
      const mark = k >= FIXED_RECTS && k < FIXED_RECTS + marks.length
      // Header, footer, panel, station markers, focus ring and level labels stay blocking.
      expect(b, `rect ${k}`).toBe(mark ? 1 << 1 : 0)
    })
  })

  it('clears nothing without an exit, or for an exit no label stands for', () => {
    expect(exempt(-1).every((b) => b === 0)).toBe(true)
    expect(exempt(3).every((b) => b === 0)).toBe(true)
  })
})

describe('placeLabels with hidden station markers', () => {
  // Top-down, north up, 500 m above the entrance: about 2.5 px a meter on an 800 px canvas.
  const camera = new PerspectiveCamera(35, 1, 10, 5000)
  camera.position.set(0, 500, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  // A station marker 15 m east of the entrance, under its first spot (right of the mark).
  const stations = [{ x: 15, z: 0 }]

  function placed(hidden: Uint8Array | null): number {
    const p = createLabelPlacement([entrance(0)], [], [{ x: 0, z: 0 }], stations, [])
    p.w[0] = 60
    p.h[0] = 12
    const view = newView(camera, 1.25)
    view.width = 800
    view.height = 800
    view.markerRadiusM = 3
    view.markerHidden = hidden
    placeLabels(p, { x: 0, z: 0 }, view, createLabelBlockers(), new Vector3(), new Vector3())
    return p.out[0]!
  }

  it('moves a label off a drawn marker, and takes that spot when the marker is hidden', () => {
    expect(placed(null)).toBe(1)
    expect(placed(new Uint8Array([0]))).toBe(1)
    expect(placed(new Uint8Array([1]))).toBe(0)
  })
})
