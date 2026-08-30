/**
 * ui-model-selection browser half on a real cordis Context with fake command/slots/
 * connection faces and real session scopes: the plugin mounts ModelDirectoryResolver
 * as `models`, the /model contribution and the conversation.input.model
 * seat both register, and BOTH entries resolve the SAME per-session
 * directory through the service — a selection submitted through the seat's
 * inject face is the current the popup's next options pass marks active
 * (and the reverse), the one-shared-state contract of the dual entry.
 * Scope disposal drops the directory (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { Session } from '../../runtime/src/client/sessions/session.ts'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandContribution, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ModelSelectInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

const sid = (k: string): SessionId => k as SessionId

const GROUPS = [{
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek-V4-Pro',
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    },
  ],
}]

/** Boot the plugin over fake faces + a stateful fake host (current moves on selectModel). */
async function bench() {
  const ctx = new Context()
  let current: ModelSelection | null = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  const calls = { models: 0, select: 0 }
  let failNextModels = false
  const api = { sessions: {
    models: () => {
      calls.models += 1
      if (failNextModels) {
        failNextModels = false
        return Promise.resolve({
          result: {
            ok: false as const,
            error: { code: 'internal' as const, message: 'temporary model read failure', details: {} },
          },
        })
      }
      return Promise.resolve({
        result: {
          ok: true as const,
          value: {
            current,
            routable,
            capabilities: { imageInput: true, modelSelection: true, fork: true },
            groups: GROUPS,
            failures: [],
          },
        },
      })
    },
    selectModel: (payload: { provider: string; model: string; reasoningEffort?: string }) => {
      calls.select += 1
      current = {
        provider: payload.provider,
        model: payload.model,
        ...payload.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: payload.reasoningEffort },
      }
      return Promise.resolve({ result: { ok: true as const, value: { selected: current } } })
    },
  } }
  // Whether the Host reports an adapter for the current route; the composer
  // block follows this, never catalog membership.
  let routable = true
  const blocks = new Map<SessionId, { reason: string } | undefined>()
  ctx.provide('conversation', {
    blocks: {
      set: (id: SessionId, block: { reason: string } | undefined) => { blocks.set(id, block) },
    },
  })
  let contribution: CommandContribution | undefined
  ctx.provide('commandUi', {
    register(c: CommandContribution) {
      contribution = c
      return () => { contribution = undefined }
    },
  })
  const seats = new Map<string, {
    inject: ((sessionId: SessionId) => ModelSelectInjected) | undefined
    locale: string | undefined
  }>()
  ctx.provide('slots', {
    inject(_name: string, callback: () => () => void) { return callback() },
    register(options: { name: string; locale?: string; inject?: (sessionId: SessionId) => ModelSelectInjected }) {
      seats.set(options.name, { inject: options.inject, locale: options.locale })
      return () => { seats.delete(options.name) }
    },
  })
  ctx.provide('locale', new LocaleRuntime(ctx))
  const scopes = new Map<SessionId, Context>()
  const sessionsByScope = new Map<Context, Session>()
  const sessionsById = new Map<SessionId, Session>()
  const addressed = new Set<SessionId>()
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ ids: [...sessionsById.keys()], current: undefined }),
      subscribe: () => () => {},
    },
    scope: (id: SessionId) => scopes.get(id),
    sessionOf: (scope: Context) => sessionsByScope.get(scope),
    binding: (id: SessionId) => {
      const session = sessionsById.get(id)
      const scope = scopes.get(id)
      return session === undefined || scope === undefined
        ? undefined
        : { sessionId: id, session, ctx: scope }
    },
    subagentAddress: (id: SessionId) => addressed.has(id)
      ? { parentSessionId: sid('parent'), childSessionId: id, mode: 'continuable' as const }
      : undefined,
  })
  new TestRemote(ctx)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await ctx.plugin(function probe() {}).await()
  const mint = (key: string, isAddressed = false) => {
    const id = sid(key)
    if (isAddressed) addressed.add(id)
    const handle = createScope(ctx, sid(key))
    const session = sessionsById.get(id) ?? new Session(id, api as never, {
      commands: {
        list: () => Promise.resolve({ ok: true as const, value: [] }),
        execute: () => Promise.resolve({ ok: true as const, value: undefined }),
      },
    }, isAddressed
      ? {
        address: {
          parentSessionId: sid('parent'),
          childSessionId: id,
          mode: 'continuable',
        },
      }
      : {})
    sessionsById.set(id, session)
    scopes.set(id, handle.ctx)
    sessionsByScope.set(handle.ctx, session)
    return handle
  }
  return {
    ctx, fiber, mint, calls,
    contribution: () => contribution!,
    seat: () => seats.get('conversation.input.model')!,
    hostCurrent: () => current,
    setHostCurrent: (selection: ModelSelection | null) => { current = selection },
    failNextModels: () => { failNextModels = true },
    reconnect: (id: SessionId, generation: number) => {
      const scope = scopes.get(id)
      const session = scope === undefined ? undefined : sessionsByScope.get(scope)
      if (session === undefined) throw new Error(`missing session ${String(id)}`)
      session.handleGenerationStart(generation)
      session.handleConnected(generation)
    },
    setRoutable: (next: boolean) => { routable = next },
    blockOf: (key: string) => blocks.get(sid(key)),
  }
}

const projection = (id: string) => ({ sessionId: sid(id) })

describe('ui-model-selection dual entry', () => {
  it('registers the /model contribution and the composer model seat', async () => {
    const b = await bench()
    expect(b.contribution().name).toBe('model')
    expect(b.contribution().ui.kind).toBe('popupSelect')
    expect(b.seat().inject).toBeTypeOf('function')
    // Copy rides the standard locale seat.
    expect(b.seat().locale).toBe('model')
  })

  it('popup options mark the host current active with the provider group in the detail', async () => {
    const b = await bench()
    b.mint('s1')
    const options = await b.contribution().ui.options(projection('s1'), new AbortController().signal)
    expect(options.map((o: SelectOption) => o.label)).toEqual(['DeepSeek-V4-Flash', 'DeepSeek-V4-Pro'])
    expect(options[0]).toMatchObject({ active: true, detail: 'DeepSeek' })
    expect(options[1]?.active).toBeUndefined()
  })

  it('lists selectable models without an active row when the Host has no current selection', async () => {
    const b = await bench()
    b.setHostCurrent(null)
    b.mint('s1')

    const options = await b.contribution().ui.options(projection('s1'), new AbortController().signal)

    expect(options.map((option: SelectOption) => option.label)).toEqual([
      'DeepSeek-V4-Flash',
      'DeepSeek-V4-Pro',
    ])
    expect(options.every((option: SelectOption) => option.active === undefined)).toBe(true)
    expect(b.seat().inject!(sid('s1')).hooks.directory.getSnapshot().current).toBeNull()
  })

  it('a seat selection is the current the popup marks active next — one shared state', async () => {
    const b = await bench()
    b.mint('s1')
    const seatFace = b.seat().inject!(sid('s1'))
    // Switch through the SEAT entry.
    expect(await seatFace.select({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })).toBeNull()
    expect(b.hostCurrent()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    expect(seatFace.hooks.directory.getSnapshot().current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    // The POPUP's next options pass reflects it without a seat-side reload.
    const options = await b.contribution().ui.options(projection('s1'), new AbortController().signal)
    expect(options.find((o: SelectOption) => o.label === 'DeepSeek-V4-Pro')).toMatchObject({ active: true })
  })

  it('a popup selection lands on the seat store — the reverse direction of the same state', async () => {
    const b = await bench()
    b.mint('s1')
    const seatFace = b.seat().inject!(sid('s1'))
    const options = await b.contribution().ui.options(projection('s1'), new AbortController().signal)
    const pro = options.find((o: SelectOption) => o.label === 'DeepSeek-V4-Pro')!
    await b.contribution().ui.onSelect(pro, projection('s1'))
    expect(seatFace.hooks.directory.getSnapshot().current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high',
    })
  })

  it('both entries share one directory instance per session, isolated across sessions', async () => {
    const b = await bench()
    b.mint('a')
    b.mint('b')
    const faceA = b.seat().inject!(sid('a'))
    const faceA2 = b.seat().inject!(sid('a'))
    const faceB = b.seat().inject!(sid('b'))
    expect(faceA.hooks.directory).toBe(faceA2.hooks.directory)
    expect(faceA.hooks.directory).not.toBe(faceB.hooks.directory)
    // The service face resolves the same instance the seat inject handed out.
    expect(b.ctx.modelDirectories.directoryFor(sid('a')).store).toBe(faceA.hooks.directory)
  })

  it('drops an unconsumed local selection and restores the Host target after reconnect', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    await face.select({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    b.setHostCurrent({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    b.reconnect(sid('s1'), 1)
    expect(face.hooks.directory.getSnapshot()).toMatchObject({ current: null, status: 'loading' })
    await Promise.resolve()
    expect(face.hooks.directory.getSnapshot()).toMatchObject({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      status: 'ready',
    })
  })

  it('scope disposal rebuilds the facade without duplicating the resident Session authority', async () => {
    const b = await bench()
    const first = b.mint('s1')
    const face1 = b.seat().inject!(sid('s1'))
    await first.fiber.dispose()
    b.mint('s1')
    const face2 = b.seat().inject!(sid('s1'))
    expect(face2.hooks.directory).toBe(face1.hooks.directory)
  })

  it('invalidates a resident Session whose UI directory was never materialized', async () => {
    const b = await bench()
    b.mint('offscreen')
    await Promise.resolve()
    await Promise.resolve()
    expect(b.calls.models).toBe(1)
    b.setHostCurrent({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })

    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    expect(b.calls.models).toBe(2)
    const models = await b.ctx.modelDirectories.directoryFor(sid('offscreen')).load()

    expect(b.calls.models).toBe(2)
    expect(models.current).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  })

  it('invalidates a resident Session after its UI directory facade is disposed', async () => {
    const b = await bench()
    const first = b.mint('offscreen')
    b.seat().inject!(sid('offscreen'))
    await Promise.resolve()
    await Promise.resolve()
    expect(b.calls.models).toBe(1)
    await first.fiber.dispose()
    b.setHostCurrent({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })

    b.ctx.remote.$dispatch('settings/document-updated', ['llm-deepseek', 1])
    expect(b.calls.models).toBe(2)
    b.mint('offscreen')
    const models = await b.ctx.modelDirectories.directoryFor(sid('offscreen')).load()

    expect(b.calls.models).toBe(2)
    expect(models.current).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  })

  it('turns an explicit load after an error into a fresh runtime read', async () => {
    const b = await bench()
    b.failNextModels()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    await Promise.resolve()
    await Promise.resolve()
    expect(face.hooks.directory.getSnapshot().status).toBe('error')
    expect(b.calls.models).toBe(1)

    face.load()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.calls.models).toBe(2)
    expect(face.hooks.directory.getSnapshot().status).toBe('ready')
  })

  it('blocks the composer only once the Host reports the route unservable', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))

    // Before the first load nothing is known. `null` is not `false`: a slow
    // or unreachable Host must never lock a working composer.
    expect(b.blockOf('s1')).toBeUndefined()
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()

    b.setRoutable(false)
    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')?.reason).toBe(zh['blocked.composer'])

    // Recovering clears it without a reload of the surface.
    b.setRoutable(true)
    b.ctx.remote.$dispatch('settings/document-updated', ['llm-deepseek', 1])
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('never blocks on catalog membership alone', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    // A model the route serves but no longer advertises: the seat prompts for
    // a selection, the composer stays usable. Blocking here would break a
    // supported configuration (a narrowed `models` list over a live route).
    b.setHostCurrent({ provider: 'deepseek-official', model: 'unlisted' })
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    const snapshot = face.hooks.directory.getSnapshot()
    expect(snapshot.groups.flatMap(group => group.models.map(model => model.id))).not.toContain('unlisted')
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('clears its block when the session scope goes', async () => {
    const b = await bench()
    b.setRoutable(false)
    const scope = b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeDefined()

    await scope.fiber.dispose()
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('an unknown session fails loud at the seat inject', async () => {
    const b = await bench()
    expect(() => b.seat().inject!(sid('ghost'))).toThrow(/resolved no scope/)
  })

  it('withholds both model entries from addressed subagent sessions without Agent-bound RPCs', async () => {
    const b = await bench()
    b.mint('child', true)

    expect(b.contribution().available(projection('child'))).toBe(false)
    await expect(b.contribution().ui.options(
      projection('child'),
      new AbortController().signal,
    )).rejects.toThrow(/unavailable for addressed subagent/)

    const face = b.seat().inject!(sid('child'))
    face.load()
    await expect(face.select({ provider: 'deepseek', model: 'deepseek-v4-pro' }))
      .resolves.toMatch(/addressed subagent/)
    await expect(b.ctx.modelDirectories.directoryFor(sid('child')).load())
      .rejects.toThrow(/unavailable for addressed subagent/)
    await expect(b.ctx.modelDirectories.directoryFor(sid('child')).select({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    })).rejects.toThrow(/unavailable for addressed subagent/)
    b.reconnect(sid('child'), 1)
    await Promise.resolve()
    expect(b.calls).toEqual({ models: 0, select: 0 })
  })
})
