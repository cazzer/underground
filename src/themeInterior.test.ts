/** The station interior's machine and outage tokens: contrast after the depth fade, and distance from the other interior tokens. */
import { describe, expect, it, vi } from 'vitest'
import { CVD, MIN_CVD_DISTANCE, oklabDistance, simulateCvd } from './lib/colorMetrics'
import { contrastRatio, mixHex } from './lib/routeColor'

// theme.ts resolves the active theme from window.location on import; tests run in node.
vi.stubGlobal('window', { location: { search: '' } })
const { MACHINE_DEPTH_FADE_SHARE, THEMES } = await import('./theme')
vi.unstubAllGlobals()

describe('interior machine tokens', () => {
  it('read at 3:1 on the background on the deepest level, after their share of the depth fade', () => {
    for (const t of Object.values(THEMES)) {
      const fade = t.interiorDepthFade * MACHINE_DEPTH_FADE_SHARE
      for (const [name, token] of [['elevator', t.interiorElevator], ['escalator', t.interiorEscalator]] as const) {
        const deepest = mixHex(token, t.background, fade)
        expect(contrastRatio(deepest, t.background), `${t.name} ${name} ${deepest}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('stand apart from the other interior tokens and each other', () => {
    for (const t of Object.values(THEMES)) {
      const others = [
        ['stroke', t.interiorStroke],
        ['track', t.interiorTrack],
        ['entrance', t.interiorEntrance],
        ['fine', t.interiorFine],
      ] as const
      for (const [name, token] of [['elevator', t.interiorElevator], ['escalator', t.interiorEscalator]] as const) {
        for (const [other, color] of others) {
          expect(oklabDistance(token, color), `${t.name} ${name} ${token} vs ${other} ${color}`).toBeGreaterThanOrEqual(0.1)
        }
      }
      expect(oklabDistance(t.interiorElevator, t.interiorEscalator), t.name).toBeGreaterThanOrEqual(0.1)
    }
  })

  it('stay apart from the stroke, track, entrance and each other under simulated deuteranopia and protanopia', () => {
    for (const t of Object.values(THEMES)) {
      for (const [mode, m] of Object.entries(CVD)) {
        const machines = oklabDistance(simulateCvd(t.interiorElevator, m), simulateCvd(t.interiorEscalator, m))
        expect(machines, `${t.name} ${mode} elevator ${t.interiorElevator} vs escalator ${t.interiorEscalator}`).toBeGreaterThanOrEqual(MIN_CVD_DISTANCE)
        for (const [name, token] of [['elevator', t.interiorElevator], ['escalator', t.interiorEscalator]] as const) {
          for (const [other, color] of [['stroke', t.interiorStroke], ['track', t.interiorTrack], ['entrance', t.interiorEntrance]] as const) {
            const d = oklabDistance(simulateCvd(token, m), simulateCvd(color, m))
            expect(d, `${t.name} ${mode} ${name} ${token} vs ${other} ${color}`).toBeGreaterThanOrEqual(MIN_CVD_DISTANCE)
          }
        }
      }
    }
  })
})

describe('interiorOutage', () => {
  it('reads at 3:1 on the background on the deepest level, after the machine depth fade', () => {
    for (const t of Object.values(THEMES)) {
      const deepest = mixHex(t.interiorOutage, t.background, t.interiorDepthFade * MACHINE_DEPTH_FADE_SHARE)
      expect(contrastRatio(deepest, t.background), `${t.name} ${deepest}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('stands apart from every other interior token, also under simulated deuteranopia and protanopia', () => {
    for (const t of Object.values(THEMES)) {
      const others = [
        ['stroke', t.interiorStroke],
        ['track', t.interiorTrack],
        ['entrance', t.interiorEntrance],
        ['fine', t.interiorFine],
        ['elevator', t.interiorElevator],
        ['escalator', t.interiorEscalator],
        ['rim', t.trainSelectedRim],
        ['focus', t.stationFocus],
      ] as const
      for (const [other, color] of others) {
        expect(oklabDistance(t.interiorOutage, color), `${t.name} vs ${other} ${color}`).toBeGreaterThanOrEqual(0.1)
        for (const [mode, m] of Object.entries(CVD)) {
          const d = oklabDistance(simulateCvd(t.interiorOutage, m), simulateCvd(color, m))
          expect(d, `${t.name} ${mode} vs ${other} ${color}`).toBeGreaterThanOrEqual(MIN_CVD_DISTANCE)
        }
      }
    }
  })
})
