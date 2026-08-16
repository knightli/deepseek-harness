/** Keyless protocol snapshot for preset admission in a shipped no-roster Web profile. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  launchWebScaffold,
  webSnapshotMode,
} from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/no-roster-preset-admission', import.meta.url))
const EXPECTED = join(SNAPSHOT_DIR, 'protocol.expected.json')
const OVERLAY = fileURLToPath(new URL('./no-roster-preset-admission.overlay.yml', import.meta.url))
const MODE = webSnapshotMode()

type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: unknown } }

interface SessionListValue {
  items: Array<{ sessionId: string }>
}

let nextRpc = 0

async function rpc<T>(baseUrl: string, method: string, payload: unknown): Promise<RpcResult<T>> {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `no-roster-preset-${String(++nextRpc)}`,
      method,
      payload,
    }),
  })
  expect(response.status).toBe(200)
  return (await response.json() as { result: RpcResult<T> }).result
}

function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

describe('web e2e: no-roster preset admission through the shipped application', () => {
  it('refuses the option before publishing a Session', async () => {
    const scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    try {
      const before = value(await rpc<SessionListValue>(scaffold.baseUrl, 'session.list', {}))
      const refused = await rpc(scaffold.baseUrl, 'session.create', {
        sessionId: 'no-roster-preset-snapshot',
        cwd: scaffold.workspaceCwd,
        agentPreset: 'unsupported',
      })
      const after = value(await rpc<SessionListValue>(scaffold.baseUrl, 'session.list', {}))

      expect(after).toEqual(before)
      const protocol = {
        beforeSessionIds: before.items.map(item => item.sessionId),
        refused,
        afterSessionIds: after.items.map(item => item.sessionId),
      }
      await compareOrRefreshGolden(EXPECTED, JSON.stringify(protocol, null, 2), MODE)
      await assertFixtureInventory(SNAPSHOT_DIR, ['protocol.expected.json'])
    } finally {
      await scaffold.close()
    }
  }, 60_000)
})
