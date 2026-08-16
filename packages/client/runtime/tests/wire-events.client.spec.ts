/**
 * Wire-to-typed-event bridge: a `host/remote-event` frame is handed verbatim to
 * the Remote service's `$dispatch` (its fan-out to `ctx.remote.$on` is
 * api-gateway's own coverage); each established connection generation emits
 * `connection/reset` for generation-scoped cache invalidation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle, ConnectionSinks } from '@deepseek-ai/dsh-api-remotes/client'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
// Type-only: the api-remotes facade carries both the allowlist's selection seat
// and the owner packages' `./types` declarations, which together give `$on` its
// key face and per-event listener signatures.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import * as RuntimeClient from '../src/client/index.ts'
import { FakeApiClient, fakeRemote } from './fake-api.client.ts'

/**
 * Compile-time face of `ctx.remote.$on`, asserted by type-checking this file
 * rather than by running it: the allowlist narrows the key set, and each
 * listener's parameters come from the owner package's own cordis `Events`
 * declaration (so a brand cannot be flattened on the way to a consumer).
 * @param ctx - any client Context carrying the Remote service.
 */
function forwardedEventContracts(ctx: Context): void {
  ctx.remote.$on('settings/document-updated', (namespace, source) => {
    // @ts-expect-error -- the brand survives the wire: a bare string is not a SettingsNamespace
    const bare: typeof namespace = 'plain-string'
    void bare; void namespace; void source
  })
  ctx.remote.$on('credentials/updated', () => {})
  ctx.remote.$on('commands/change', () => {})
  ctx.remote.$on('llm/adapters-updated', () => {})
  ctx.remote.$on('agent-preset/selected', (sessionId, agentPreset) => {
    void sessionId; void agentPreset
  })
  // @ts-expect-error -- client-local event outside the allowlist
  ctx.remote.$on('slots/changed', () => {})
  // @ts-expect-error -- declared host event the allowlist does not select
  ctx.remote.$on('skills/change', () => {})
}
void forwardedEventContracts

interface Bench {
  ctx: Context
  api: FakeApiClient
  sinks: ConnectionSinks | undefined
  /** Every `$dispatch` the runtime made, as `[event, ...args]`. */
  dispatched: unknown[][]
}

async function mount(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  const api = new FakeApiClient()
  const bench: Bench = { ctx, api, sinks: undefined, dispatched: [] }
  // Stands in for api-gateway's Remote service: this spec owns the carrier's
  // handoff, not the fan-out behind it.
  ctx.reflect.provide('remote', {
    $dispatch: (event: string, args: readonly unknown[]) => { bench.dispatched.push([event, ...args]) },
  })
  const handle: ConnectionHandle = {
    api,
    isLoopback: true,
    hostDescription: {
      getSnapshot: () => undefined,
      subscribe: () => () => {},
    },
    connectionState: {
      getSnapshot: () => undefined,
      subscribe: () => () => {},
    },
    rpc: {
      call: () => Promise.reject(new Error('unexpected generic RPC call')),
    },
    start: (sinks) => {
      bench.sinks = sinks
      return { stop: () => {} }
    },
  }
  ctx.reflect.provide('connection', handle)
  ctx.reflect.provide('remote.commands', fakeRemote().commands)
  await ctx.plugin(RuntimeClient).await()
  return bench
}

describe('wire event bridge', () => {
  it('republishes a forwarded host event verbatim, and routes no other host frame there', async () => {
    const bench = await mount()
    const seen = bench.dispatched
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r1' as never,
      payload: { type: 'host/remote-event', event: 'commands/change', args: [] },
    })
    expect(seen).toEqual([['commands/change']])

    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r2' as never,
      payload: { type: 'host/session-status', sessionId: 's1' as never, running: true },
    })
    expect(seen).toEqual([['commands/change']])
  })

  it('carries each forwarded event name with its own argument list, unfiltered', async () => {
    const bench = await mount()
    const seen = bench.dispatched

    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r3' as never,
      payload: { type: 'host/remote-event', event: 'settings/document-updated', args: ['llm-pi-ai', 7] },
    })
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r4' as never,
      payload: { type: 'host/remote-event', event: 'credentials/updated', args: ['OPENAI_API_KEY'] },
    })
    // The carrier does not second-guess the name: selecting what a consumer can
    // receive is the allowlist's job, and dropping an unsubscribed name is the
    // Remote service's. This plugin republishes whatever the frame carried.
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r5' as never,
      payload: { type: 'host/remote-event', event: 'nobody/listening', args: ['ignored'] },
    })

    expect(seen).toEqual([
      ['settings/document-updated', 'llm-pi-ai', 7],
      ['credentials/updated', 'OPENAI_API_KEY'],
      ['nobody/listening', 'ignored'],
    ])
  })

  it('broadcasts connection/reset on every established generation (reconnect invalidation)', async () => {
    const bench = await mount()
    let resets = 0
    bench.ctx.on('connection/reset', () => { resets++ })
    const description = { version: '0', cwd: '/f', attachedSessions: 0, canOpenPath: true }
    bench.sinks?.onConnected?.(description)
    bench.sinks?.onConnected?.(description) // second generation after a reconnect
    expect(resets).toBe(2)
  })

  it('keeps a replayed approval answerable when it arrives before reconnect readiness', async () => {
    const bench = await mount()
    const sessionId = 's-reconnect' as never
    const approvalId = 'a-reconnect' as never
    const description = {
      version: '0', cwd: '/f', attachedSessions: 1, canOpenPath: true,
    }
    bench.sinks?.onGenerationStart?.(1)
    bench.sinks?.onConnected?.(description)
    await vi.waitFor(() => {
      expect(bench.api.callsOf('session.list')).toHaveLength(1)
    })
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'host-added' as never,
      payload: { type: 'host/session-added', sessionId, blank: false },
    })
    await Promise.resolve()

    const sessions = bench.ctx.sessions as RuntimeClient.SessionRuntime
    sessions.open(sessionId)
    await vi.waitFor(() => {
      expect(bench.api.callsOf('session.history')).toHaveLength(1)
    })
    const session = sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error('session binding was not materialized')

    const requested = {
      type: 'approval/requested' as const,
      sessionId,
      approvalId,
      toolName: 'write',
    }
    bench.sinks?.onMuxEnvelope?.({ rpcId: 'old-generation' as never, payload: requested })
    const stale = session.getSnapshot().pending[0]
    if (stale === undefined) throw new Error('initial interaction was not materialized')

    bench.sinks?.onStateChange?.('reconnecting')
    expect(session.getSnapshot().pending).toHaveLength(1)
    await expect(stale.respond({
      ok: true,
      value: { sessionId, approvalId, outcome: 'allowed-once' },
    })).rejects.toThrow('pending interaction is unavailable on this connection generation')
    expect(bench.api.callsOf('respond')).toEqual([])

    bench.sinks?.onGenerationStart?.(2)
    bench.sinks?.onMuxEnvelope?.({ rpcId: 'old-generation' as never, payload: requested })
    const replayed = session.getSnapshot().pending[0]
    if (replayed === undefined) throw new Error('replayed interaction was not materialized')
    expect(replayed).not.toBe(stale)
    expect(replayed.key).toBe('a:old-generation')
    await expect(replayed.respond({
      ok: true,
      value: { sessionId, approvalId, outcome: 'allowed-once' },
    })).rejects.toThrow('pending interaction is unavailable on this connection generation')

    bench.sinks?.onConnected?.(description)
    await vi.waitFor(() => {
      expect(bench.api.callsOf('session.history')).toHaveLength(2)
    })
    expect(session.getSnapshot().pending[0]).toBe(replayed)

    await replayed.respond({
      ok: true,
      value: { sessionId, approvalId, outcome: 'allowed-once' },
    })
    expect(bench.api.callsOf('respond')).toMatchObject([{
      rpcId: 'old-generation',
      result: {
        ok: true,
        value: { sessionId, approvalId, outcome: 'allowed-once' },
      },
    }])
    bench.sinks?.onMuxEnvelope?.({
      rpcId: 'resolved' as never,
      payload: { type: 'approval/resolved', sessionId, approvalId, outcome: 'approved' as never },
    })
    expect(session.getSnapshot().pending).toEqual([])
    expect(sessions.list.getSnapshot().byId[sessionId]?.pendingInteraction).toBeUndefined()
  })
})
