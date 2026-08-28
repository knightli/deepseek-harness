// @vitest-environment jsdom
/**
 * Built-bundle proof for the plain-HTTP private-LAN browser shape. The staged
 * connection bundle must install randomUUID before any downstream client
 * package creates RPC or message identities.
 */

import { screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)

installAssembledBootEnv()

beforeEach(() => {
  vi.stubGlobal('crypto', { getRandomValues })
})

it('boots built client bundles when the origin lacks crypto.randomUUID', async () => {
  mountAssembledApp()

  await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  expect(typeof globalThis.crypto.randomUUID).toBe('function')
  expect(globalThis.crypto.randomUUID()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})
