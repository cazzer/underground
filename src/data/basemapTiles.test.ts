import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import { CAP_Z, capStep, newCap } from '../lib/basemap/locationCap'
import type { ViewPose } from '../lib/basemap/reselect'
import { keyZ } from '../lib/basemap/tileMath'
import { groundX, groundZ } from '../lib/projection'
import { packTracks } from '../lib/routeTracks'
import type { BasemapConfig } from './basemapConfig'
import type { BasemapReply, BasemapRequest } from './basemapProtocol'
import { createBasemapTiles, MAX_IN_FLIGHT, RETRY_MS } from './basemapTiles'
import type { BasemapWorkerLike } from './basemapTypes'

const CONFIG: BasemapConfig = { bbox: [-74.2591, 40.4774, -73.7004, 40.9176], maxzoom: 15, layers: ['water', 'landuse', 'roads'], version: 'test' }
type Load = Extract<BasemapRequest, { type: 'load' }>
const TRACKS = packTracks([{ points: [{ x: 0, z: 0 }, { x: 100, z: 0 }] }])

class FakeWorker implements BasemapWorkerLike {
  sent: BasemapRequest[] = []
  onmessage: ((e: MessageEvent<BasemapReply>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  onmessageerror: ((e: MessageEvent) => void) | null = null
  postMessage(m: BasemapRequest) {
    this.sent.push(m)
  }
  terminate() {}
  loads(): Load[] {
    return this.sent.filter((m): m is Load => m.type === 'load')
  }
  cancels(): number[] {
    return this.sent.flatMap((m) => (m.type === 'cancel' ? [m.key] : []))
  }
  reply(r: BasemapReply) {
    this.onmessage!({ data: r } as MessageEvent<BasemapReply>)
  }
  tile(l: Load) {
    this.reply({ type: 'tile', key: l.key, seq: l.seq, classes: {}, decodeMs: 1, bodyBytes: 10 })
  }
}

/** A view of `distance` m over (lon, lat), nearly top-down, and the camera that sees it. */
function view(lon: number, lat: number, distance: number): { pose: ViewPose; camera: PerspectiveCamera } {
  const tx = groundX(lon)
  const tz = groundZ(lat)
  const camera = new PerspectiveCamera(35, 1.5, 10, 1e6)
  camera.position.set(tx, distance, tz + distance * 0.01)
  camera.lookAt(tx, 0, tz)
  camera.updateProjectionMatrix()
  return { pose: { tx, tz, distance, azimuth: 0, width: 1200, height: 800 }, camera }
}

function setup() {
  const fake = new FakeWorker()
  const store = createBasemapTiles(CONFIG, TRACKS, { createWorker: () => fake })
  store.start()
  /** Updates with the view and again 200 ms later, so a changed view is reselected. */
  const show = (v: ReturnType<typeof view>, t: number) => {
    store.update(v.pose, v.camera, t)
    store.update(v.pose, v.camera, t + 200)
  }
  return { fake, store, show }
}

const CITY_HALL = view(-74.006, 40.7128, 2000)
const BRONX = view(-73.88, 40.85, 2000)

describe('createBasemapTiles with a fake worker', () => {
  it('asks for nothing before start and inits the worker with the layers and the tracks', () => {
    const fake = new FakeWorker()
    const store = createBasemapTiles(CONFIG, TRACKS, { createWorker: () => fake })
    store.update(CITY_HALL.pose, CITY_HALL.camera, 0)
    expect(fake.sent).toEqual([])
    store.start()
    expect(fake.sent).toEqual([{ type: 'init', layers: CONFIG.layers, tracks: TRACKS }])
  })

  it('keeps at most MAX_IN_FLIGHT loads out, nearest first, and sends the next on each reply', () => {
    const { fake, store, show } = setup()
    show(CITY_HALL, 0)
    expect(store.stats().wanted).toBeGreaterThan(MAX_IN_FLIGHT)
    expect(fake.loads()).toHaveLength(MAX_IN_FLIGHT)
    expect(fake.loads()[0]!.url).toBe(`${import.meta.env.BASE_URL}basemap/tiles/15/9647/12320.mvt?v=test`)
    fake.tile(fake.loads()[0]!)
    expect(fake.loads()).toHaveLength(MAX_IN_FLIGHT + 1)
    expect(store.stats().inFlight).toBe(MAX_IN_FLIGHT)
    expect(store.drawn.map((t) => t.key)).toEqual([fake.loads()[0]!.key])
  })

  it('cancels in-flight tiles the new view no longer wants, and a late reply to one is dropped', () => {
    const { fake, store, show } = setup()
    show(CITY_HALL, 0)
    const first = fake.loads().slice()
    show(BRONX, 1000)
    expect(fake.cancels().sort()).toEqual(first.map((l) => l.key).sort())
    const v = store.version
    fake.tile(first[0]!)
    expect(store.stats().stale).toBe(1)
    expect(store.stats().cachedTiles).toBe(0)
    expect(store.version).toBe(v)
    expect(store.stats().inFlight).toBe(MAX_IN_FLIGHT)
  })

  it('asks for a failed tile again only after RETRY_MS', () => {
    const { fake, store, show } = setup()
    show(CITY_HALL, 0)
    const l = fake.loads()[0]!
    fake.reply({ type: 'error', key: l.key, seq: l.seq, message: 'HTTP 503' })
    const asked = () => fake.loads().filter((x) => x.key === l.key).length
    store.update(CITY_HALL.pose, CITY_HALL.camera, 200 + RETRY_MS - 1)
    // Drain the other loads so there is room in flight.
    for (const x of fake.loads().slice(1)) fake.tile(x)
    expect(asked()).toBe(1)
    store.update(CITY_HALL.pose, CITY_HALL.camera, 200 + RETRY_MS)
    expect(asked()).toBe(2)
  })

  it('never asks for an empty tile again', () => {
    const { fake, show } = setup()
    show(CITY_HALL, 0)
    const l = fake.loads()[0]!
    fake.reply({ type: 'empty', key: l.key, seq: l.seq, reason: 'missing', detail: 'HTTP 404' })
    show(BRONX, 1000)
    show(CITY_HALL, 2000)
    expect(fake.loads().filter((x) => x.key === l.key)).toHaveLength(1)
  })

  it('under the location cap asks for nothing finer than CAP_Z, through a tap, until a pan lifts it', () => {
    const { fake, store, show } = setup()
    const cap = newCap()
    const step = (e: Parameters<typeof capStep>[1]) => {
      const was = cap.capped
      if (capStep(cap, e)) store.capZoom(null)
      else if (!was && cap.capped) store.capZoom(CAP_Z)
    }
    step({ type: 'pointFlight' })
    show(CITY_HALL, 0)
    const finer = () => fake.loads().filter((l) => keyZ(l.key) > CAP_Z)
    expect(fake.loads().length).toBeGreaterThan(0)
    expect(finer()).toEqual([])
    step({ type: 'down', id: 1, x: 100, y: 100, touch: false, primary: true })
    step({ type: 'move', id: 1, x: 103, y: 102 })
    step({ type: 'up', id: 1 })
    show(CITY_HALL, 1000)
    expect(finer()).toEqual([])
    step({ type: 'down', id: 2, x: 100, y: 100, touch: false, primary: true })
    step({ type: 'move', id: 2, x: 140, y: 100 })
    // The view hasn't changed: the lift alone picks z15 tiles for it.
    store.update(CITY_HALL.pose, CITY_HALL.camera, 1300)
    expect(store.z).toBe(15)
    expect(finer().length).toBeGreaterThan(0)
  })

  it('cancels finer loads already out when the cap goes on', () => {
    const { fake, store, show } = setup()
    show(CITY_HALL, 0)
    store.capZoom(CAP_Z)
    expect(fake.cancels()).toHaveLength(MAX_IN_FLIGHT)
    expect(store.stats().inFlight).toBe(0)
  })

  it('turns itself off when the worker fails', () => {
    const { fake, store, show } = setup()
    show(CITY_HALL, 0)
    fake.tile(fake.loads()[0]!)
    const errors: unknown[] = []
    const original = console.error
    console.error = (...a: unknown[]) => errors.push(a)
    try {
      fake.onerror!({ message: 'boom' } as ErrorEvent)
    } finally {
      console.error = original
    }
    expect(errors).toHaveLength(1)
    expect(store.stats().disabled).toBe(true)
    expect(store.drawn).toEqual([])
  })
})
