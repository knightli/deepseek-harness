// @vitest-environment jsdom
/**
 * Keyless assembled reconnect proof over the real built client bundles. The
 * FixtureApiClient timing hook tears down both physical streams; the native
 * DSH frame must become inert while reconnecting, then retain the replayed
 * interaction and restore it only after the next generation is ready.
 */

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

interface FixtureTimingHooks {
  breakStreams(): void
}

installAssembledBootEnv()

it('fences the native frame and replays its pending interaction across a physical reconnect', async () => {
  mountAssembledApp()

  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  const title = await within(tree).findByText('Fixture 历史会话')
  fireEvent.click(title)
  const allow = await screen.findByRole('button', { name: 'Allow once' })
  expect(allow.matches(':disabled')).toBe(false)

  const timing = (globalThis as Record<string, unknown>).__fxTiming as FixtureTimingHooks | undefined
  if (timing === undefined) throw new Error('assembled FixtureApiClient did not publish its timing hook')
  timing.breakStreams()

  await waitFor(() => {
    expect(screen.getByText(/重连/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Allow once' }).matches(':disabled')).toBe(true)
  }, { timeout: 10_000, interval: 10 })

  await waitFor(() => {
    expect(screen.queryByText(/重连/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Allow once' }).matches(':disabled')).toBe(false)
  }, { timeout: 10_000, interval: 10 })

  // The request was replayed with its still-live rpcId rather than replaced by
  // a parallel interaction store; the ordinary native action remains usable.
  fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull()
  })
})
