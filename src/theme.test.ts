import { describe, expect, it, vi } from 'vitest'
import { contrastRatio } from './lib/routeColor'

describe('status tokens', () => {
  it('read at 4.5:1 on every theme background', async () => {
    // theme.ts resolves the active theme from window.location on import; tests run in node.
    vi.stubGlobal('window', { location: { search: '' } })
    const { THEMES } = await import('./theme')
    vi.unstubAllGlobals()
    for (const t of Object.values(THEMES)) {
      for (const color of [t.statusLive, t.statusWarn, t.statusError]) {
        expect(contrastRatio(color, t.background), `${t.name} ${color}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
