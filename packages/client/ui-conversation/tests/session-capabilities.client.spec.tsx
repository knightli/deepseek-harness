// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { SessionCapabilities } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { useSessionCapabilities } from '../src/client/session-capabilities.ts'

afterEach(cleanup)

const A = 'capability-a' as SessionId
const B = 'capability-b' as SessionId
const SUPPORTED: SessionCapabilities = Object.freeze({
  imageInput: true,
  modelSelection: true,
  fork: true,
})

interface ProbeProps {
  readonly sessionId: SessionId
  readonly load: (sessionId: SessionId) => Promise<SessionCapabilities>
  readonly renders: boolean[]
}

function CapabilityProbe({ sessionId, load, renders }: ProbeProps): null {
  renders.push(useSessionCapabilities(sessionId, load).imageInput)
  return null
}

describe('useSessionCapabilities identity fencing', () => {
  it.each(['false', 'deferred', 'error'] as const)(
    'returns unavailable on the first A to B render when B is %s',
    async (mode) => {
      const pending = new Promise<SessionCapabilities>(() => undefined)
      const load = vi.fn((sessionId: SessionId) => {
        if (sessionId === A) return Promise.resolve(SUPPORTED)
        if (mode === 'false') {
          return Promise.resolve({ ...SUPPORTED, imageInput: false })
        }
        if (mode === 'error') return Promise.reject(new Error('capability unavailable'))
        return pending
      })
      const renders: boolean[] = []
      const view = render(<CapabilityProbe sessionId={A} load={load} renders={renders} />)
      await act(async () => { await Promise.resolve() })
      expect(renders.at(-1)).toBe(true)

      renders.length = 0
      view.rerender(<CapabilityProbe sessionId={B} load={load} renders={renders} />)

      expect(renders[0]).toBe(false)
    },
  )

  it('returns unavailable when the loader identity changes before the new read settles', async () => {
    const first = vi.fn(() => Promise.resolve(SUPPORTED))
    const second = vi.fn(() => new Promise<SessionCapabilities>(() => undefined))
    const renders: boolean[] = []
    const view = render(<CapabilityProbe sessionId={A} load={first} renders={renders} />)
    await act(async () => { await Promise.resolve() })
    expect(renders.at(-1)).toBe(true)

    renders.length = 0
    view.rerender(<CapabilityProbe sessionId={A} load={second} renders={renders} />)

    expect(renders[0]).toBe(false)
  })
})
