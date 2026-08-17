/** Public-Host regression for roster teardown during unpublished Agent setup. */

import { describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { launchWebScaffold } from './scaffold.ts'

const SHIPPED_PRESETS = fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url))

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
      rpcId: `preset-roster-lifecycle-${String(++nextRpc)}`,
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

describe('web e2e: preset roster lifecycle at Session publication', () => {
  it('rolls back a Session when its resolved roster unloads before setup', async () => {
    const scaffold = await launchWebScaffold({
      agentPresets: {
        default: 'standard',
        roots: [{ path: SHIPPED_PRESETS, trust: 'system' }],
      },
    })
    const create = scaffold.ctx.agents.create.bind(scaffold.ctx.agents)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let creating: Promise<RpcResult<unknown>> | undefined
    let restoreCreate: (() => void) | undefined
    try {
      const rosterEntry = [...scaffold.ctx.loader.entries()]
        .find(entry => entry.options.id === 'agent-presets')
      if (rosterEntry === undefined) throw new Error('shipped Web composition did not mount agent-presets')
      value(await rpc(scaffold.baseUrl, 'session.create', {
        sessionId: 'preset-roster-standing-seed',
        cwd: scaffold.workspaceCwd,
        agentPreset: 'standard',
      }))
      const before = value(await rpc<SessionListValue>(scaffold.baseUrl, 'session.list', {}))
      const createSpy = vi.spyOn(scaffold.ctx.agents, 'create').mockImplementation(async (options) => {
        entered.resolve(undefined)
        await release.promise
        return await create(options)
      })
      restoreCreate = () => { createSpy.mockRestore() }

      creating = rpc(scaffold.baseUrl, 'session.create', {
        sessionId: 'preset-roster-unloaded-before-setup',
        cwd: scaffold.workspaceCwd,
        agentPreset: 'standard',
      })
      await entered.promise
      if (rosterEntry.fiber === undefined) throw new Error('agent-presets entry has no live fiber')
      await rosterEntry.fiber.dispose()
      release.resolve(undefined)

      const refused = await creating
      const after = value(await rpc<SessionListValue>(scaffold.baseUrl, 'session.list', {}))

      expect(refused).toMatchObject({
        ok: false,
        error: {
          code: 'agent-preset-not-found',
          details: { agentPreset: 'standard', available: [] },
        },
      })
      expect(after.items.map(item => item.sessionId)).toEqual(before.items.map(item => item.sessionId))
      expect(scaffold.ctx.agents.get('preset-roster-unloaded-before-setup' as never)).toBeUndefined()
      expect(scaffold.ctx.sessions.get('preset-roster-unloaded-before-setup' as never)).toBeUndefined()
    } finally {
      release.resolve(undefined)
      await creating?.catch(() => undefined)
      restoreCreate?.()
      await scaffold.close()
    }
  }, 60_000)
})
