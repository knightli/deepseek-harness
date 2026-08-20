import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context, Service, symbols } from '@deepseek-ai/cordis'
import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import AgentRegistry, {
  agentEvents,
  AgentFactoryCapabilityUnavailableError,
  Inbox,
} from '@deepseek-ai/dsh-agent'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'

import type {
  Agent,
  AgentCancelCause,
  AgentFactory,
  AgentStatus,
  CreateAgentOptions,
  ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'

function stubAgent(rawId: string, overrides: Partial<Agent> = {}): Agent {
  const id = SessionId(rawId)
  const session = Session.create(id)
  const agent: Agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  return Object.assign(agent, overrides)
}

describe('Inbox', () => {
  it('rejects an invalid durable splice during reconstruction', () => {
    const session = Session.create(SessionId('invalid-inbox-replay'))
    session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 1,
      inserted: [],
    })

    expect(() => new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }))
      .toThrow('invalid persisted inbox splice at session seq 0')
  })

  it('replaces a pending message by identity across both lists', () => {
    const session = Session.create(SessionId('replace-inbox'))
    const inserted: UserMessage[] = []
    const discarded: UserMessage[] = []
    const inbox = new Inbox(session, {
      claimed: () => {},
      inserted: message => void inserted.push(message),
      discarded: message => void discarded.push(message),
    })
    const original = createUserMessage({
      content: [{ type: 'text', text: 'original' }],
      source: { kind: 'user' },
    })
    const nextStep = createUserMessage({
      content: [{ type: 'text', text: 'step' }],
      source: { kind: 'user' },
    })
    const replacement = createUserMessage({
      content: [{ type: 'text', text: 'replacement' }],
      source: { kind: 'user' },
    })
    const editedStep = freezeMessage({
      ...nextStep,
      content: [{ type: 'text', text: 'edited step' }],
    })
    inbox.append('next-turn', original)
    inbox.append('next-step', nextStep)

    expect(inbox.replace(createUserMessage({
      content: [{ type: 'text', text: 'missing' }],
      source: { kind: 'user' },
    }).id, replacement)).toBe(false)
    expect(inbox.replace(original.id, replacement)).toBe(true)
    expect(inbox.replace(nextStep.id, editedStep)).toBe(true)
    expect(inbox.nextTurn).toEqual([replacement])
    expect(inbox.nextStep).toEqual([editedStep])
    expect(discarded).toEqual([original, nextStep])
    expect(inserted).toEqual([original, nextStep, replacement, editedStep])
    expect(() => { inbox.replace(editedStep.id, replacement) })
      .toThrow(`message "${replacement.id}" is already pending`)
  })

  it('normalizes splice coordinates, rejects duplicate identities, and reports missing removals', () => {
    const session = Session.create(SessionId('splice-inbox'))
    const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
    const first = createUserMessage({
      content: [{ type: 'text', text: 'first' }],
      source: { kind: 'user' },
    })
    const second = createUserMessage({
      content: [{ type: 'text', text: 'second' }],
      source: { kind: 'user' },
    })

    inbox.splice('next-turn', Number.NaN, Number.NaN, [first, second])
    expect(inbox.nextTurn).toEqual([first, second])
    expect(inbox.splice('next-turn', -1, 1, [])).toEqual([second])
    expect(inbox.remove(second.id)).toBe(false)
    expect(() => { inbox.append('next-step', first) }).toThrow(`message "${first.id}" is already pending`)
  })

  it('clears both pending lists as durable cancellations', () => {
    const session = Session.create(SessionId('clear-inbox'))
    const discarded: UserMessage[] = []
    const inbox = new Inbox(session, {
      claimed: () => {},
      inserted: () => {},
      discarded: message => void discarded.push(message),
    })
    const nextTurn = createUserMessage({ content: [{ type: 'text', text: 'turn' }], source: { kind: 'user' } })
    const nextStep = createUserMessage({ content: [{ type: 'text', text: 'step' }], source: { kind: 'user' } })
    inbox.append('next-turn', nextTurn)
    inbox.append('next-step', nextStep)
    const beforeClear = session.events.length

    inbox.clear()

    expect(inbox.hasPending).toBe(false)
    expect(discarded).toEqual([nextStep, nextTurn])
    expect(session.events.slice(beforeClear).map(event => event.type === 'agent/inbox/spliced'
      ? event.data
      : event.type)).toEqual([
      { target: 'next-step', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' },
      { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' },
    ])

    inbox.clear()
    expect(session.events).toHaveLength(beforeClear + 2)
  })

  it('claims only the requested next-step prefix without discarding the pending tail', () => {
    const session = Session.create(SessionId('claim-prefix-inbox'))
    const claimedNotifications: Array<{ message: UserMessage; turn: number }> = []
    const discarded: UserMessage[] = []
    const inbox = new Inbox(session, {
      claimed: (message, turn) => void claimedNotifications.push({ message, turn }),
      inserted: () => {},
      discarded: message => void discarded.push(message),
    })
    const first = createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } })
    const second = createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } })
    inbox.append('next-step', first)
    inbox.append('next-step', second)
    const beforeClaim = session.events.length

    expect(inbox.claim('next-step', 7, 1)).toEqual([first])

    expect(inbox.nextStep).toEqual([second])
    expect(claimedNotifications).toEqual([{ message: first, turn: 7 }])
    expect(discarded).toEqual([])
    expect(session.events.slice(beforeClaim).map(event => event.type === 'agent/inbox/spliced'
      ? event.data
      : event.type)).toEqual([
      { target: 'next-step', start: 0, removedCount: 1, inserted: [] },
    ])
    expect(() => inbox.claim('next-step', 8, Number.NaN))
      .toThrow('next-step claim limit must be a non-negative safe integer')
    expect(() => inbox.claim('next-step', 8, -1))
      .toThrow('next-step claim limit must be a non-negative safe integer')
    expect(inbox.nextStep).toEqual([second])
  })
})

describe('AgentRegistry', () => {
  it('contributes Agent lookup and scoped Context providers while Typert is live', async () => {
    const ctx = new Context()
    const agentFiber = ctx.plugin(AgentRegistry)
    await agentFiber
    await ctx.plugin(TypertRegistry)
    const agent = stubAgent('remote-agent')
    const disposeAgent = ctx.agents.register(agent)

    const lookup = ctx.typert.lookups.get('agent')
    expect(lookup).toMatchObject({
      parameter: 'agent',
      wire: 'agentId',
      hostTypeSymbol: '@deepseek-ai/dsh-agent#Agent',
      wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
    })
    expect(lookup?.resolve(agent.id)).toBe(agent)
    expect(ctx.typert.contexts.getHost('agent')?.resolve(agent.id)).toBe(agent.ctx)

    disposeAgent()
    expect(lookup?.resolve(agent.id)).toBeUndefined()
    await agentFiber.dispose()
    expect(ctx.typert.lookups.get('agent')).toBeUndefined()
    expect(ctx.typert.contexts.getHost('agent')).toBeUndefined()
  })

  it('registers exact entries, emits lifecycle events, and unregisters on owner disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const lifecycle: string[] = []
    ctx.on('agent/created', ({ agent }) => void lifecycle.push(`created:${agent.id}`))
    ctx.on('agent/disposed', ({ agent }) => void lifecycle.push(`disposed:${agent.id}`))

    const agent = stubAgent('a1')
    const dispose = ctx.agents.register(agent)
    expect(ctx.agents.get(agent.id)).toBe(agent)
    expect(ctx.agents.list()).toEqual([agent])
    expect(ctx.agents.roots()).toEqual([agent])
    expect(() => ctx.agents.register(stubAgent('a1'))).toThrow(/already registered/)

    dispose()
    expect(ctx.agents.get(agent.id)).toBeUndefined()
    expect(lifecycle).toEqual(['created:a1', 'disposed:a1'])
  })

  it('rejects an agent whose registry and session identities differ', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const agent = stubAgent('agent-id', { session: Session.create(SessionId('session-id')) })

    expect(() => ctx.agents.enter(agent, undefined))
      .toThrow('agent id "agent-id" does not match session id "session-id"')
    expect(ctx.agents.list()).toEqual([])
  })

  it('tracks runtime creator ownership separately from registry order', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const root = stubAgent('root')
    const child = stubAgent('child')
    const detachRoot = ctx.agents.enter(root, undefined)
    ctx.agents.announce(root)
    const detachChild = ctx.agents.enter(child, root)
    ctx.agents.announce(child)

    expect(ctx.agents.list()).toEqual([root, child])
    expect(ctx.agents.roots()).toEqual([root])
    expect(ctx.agents.isOwnedBy(child.id, root)).toBe(true)
    expect(ctx.agents.isOwnedBy(root.id, root)).toBe(false)
    expect(ctx.agents.isOwnedBy(SessionId('missing'), root)).toBe(false)

    detachChild()
    expect(ctx.agents.isOwnedBy(child.id, root)).toBe(false)
    detachRoot()
  })

  it('rolls an entry back and pairs a partially delivered creation when a listener throws', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const lifecycle: string[] = []
    ctx.on('agent/created', ({ agent }) => void lifecycle.push(`created:${agent.id}`))
    ctx.on('agent/created', () => { throw new Error('creation veto') })
    ctx.on('agent/disposed', ({ agent }) => void lifecycle.push(`disposed:${agent.id}`))

    expect(() => ctx.agents.register(stubAgent('vetoed'))).toThrow('creation veto')
    expect(ctx.agents.get(SessionId('vetoed'))).toBeUndefined()
    expect(lifecycle).toEqual(['created:vetoed', 'disposed:vetoed'])
  })

  it('contains asynchronous creation rejection and every disposal-listener failure', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const warnings: string[] = []
    const heard: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    ctx.on('agent/created', () => Promise.reject(new Error('created async')) as never)
    ctx.on('agent/disposed', () => { throw new Error('disposed sync') })
    ctx.on('agent/disposed', () => Promise.reject(new Error('disposed async')) as never)
    ctx.on('agent/disposed', ({ agent }) => void heard.push(agent.id))

    const dispose = ctx.agents.register(stubAgent('contained'))
    await Promise.resolve()
    dispose()
    await Promise.resolve()

    expect(heard).toEqual(['contained'])
    expect(warnings).toEqual([
      'agent "contained": agent/created listener rejected: Error: created async',
      'agent "contained": agent/disposed listener threw: Error: disposed sync',
      'agent "contained": agent/disposed listener rejected: Error: disposed async',
    ])
  })

  it('separates entry from announcement and stale/idempotent detach cannot remove a replacement', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const lifecycle: string[] = []
    ctx.on('agent/created', ({ agent }) => void lifecycle.push(`created:${agent.id}`))
    ctx.on('agent/disposed', ({ agent }) => void lifecycle.push(`disposed:${agent.id}`))

    const first = stubAgent('split')
    const detachFirst = ctx.agents.enter(first, undefined)
    expect(lifecycle).toEqual([])
    ctx.agents.announce(first)
    expect(() => { ctx.agents.announce(first) }).toThrow(/already announced/)
    detachFirst()
    detachFirst()

    const replacement = stubAgent('split')
    const detachReplacement = ctx.agents.enter(replacement, undefined)
    detachFirst()
    expect(ctx.agents.get(replacement.id)).toBe(replacement)
    expect(() => { ctx.agents.announce(first) }).toThrow(/not live/)
    detachReplacement()
    expect(lifecycle).toEqual(['created:split', 'disposed:split'])
  })

  it('defers detach requested by a creation listener until that dispatch unwinds', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const order: string[] = []
    const agent = stubAgent('reentrant')
    ctx.on('agent/created', () => {
      order.push(`first:${ctx.agents.get(agent.id) === agent}`)
      detach()
      order.push(`after-detach:${ctx.agents.get(agent.id) === agent}`)
    })
    ctx.on('agent/created', () => void order.push(`second:${ctx.agents.get(agent.id) === agent}`))
    ctx.on('agent/disposed', () => void order.push('disposed'))
    const detach = ctx.agents.enter(agent, undefined)
    ctx.agents.announce(agent)
    expect(order).toEqual(['first:true', 'after-detach:true', 'second:true', 'disposed'])
    expect(ctx.agents.get(agent.id)).toBeUndefined()
  })
})

describe('agentEvents()', () => {
  it('contains each synchronous throw and returned-promise rejection', async () => {
    const ctx = new Context()
    const warnings: string[] = []
    const heard: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    const agent = stubAgent('event')
    ctx.on('agent/status', () => { throw new Error('sync listener') })
    ctx.on('agent/status', () => Promise.reject(new Error('async listener')) as never)
    ctx.on('agent/status', ({ status }) => void heard.push(status))

    agentEvents(ctx, agent).emit('agent/status', { status: 'running' })
    await Promise.resolve()
    expect(heard).toEqual(['running'])
    expect(warnings).toEqual([
      'agent event "agent/status" listener threw: Error: sync listener',
      'agent event "agent/status" listener rejected: Error: async listener',
    ])
  })

  it('dispatches serial listeners with the fused agent subject', async () => {
    const ctx = new Context()
    const agent = stubAgent('serial-event')
    const signal = new AbortController().signal
    const heard: Array<{ agent: Agent; turn: number; signal: AbortSignal }> = []
    ctx.on('agent/turn-stopping', async ({ agent: subject, turn, signal: receivedSignal }) => {
      await Promise.resolve()
      heard.push({ agent: subject, turn, signal: receivedSignal })
    })

    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 3, signal })

    expect(heard).toEqual([{ agent, turn: 3, signal }])
  })

  it('injects the fused subject even when the payload carries a conflicting agent field', async () => {
    const ctx = new Context()
    const agent = stubAgent('fused-subject')
    const other = stubAgent('payload-agent')
    const heard: Agent[] = []
    ctx.on('agent/status', ({ agent: subject }) => void heard.push(subject))
    // A structurally acceptable payload may carry an extra `agent` field; the
    // dispatcher's injected subject must win over it.
    const payload: { status: AgentStatus; agent: Agent } = { status: 'running', agent: other }

    agentEvents(ctx, agent).emit('agent/status', payload)

    expect(heard).toEqual([agent])
  })
})

describe('explicit cancellation contract', () => {
  it('exposes the closed typed cancellation cause at the Agent seam', () => {
    expectTypeOf<Parameters<Agent['cancel']>[0]>().toEqualTypeOf<AgentCancelCause>()
  })
})

describe('AgentRegistry factory seam', () => {
  function stubFactory() {
    const calls: {
      create: Array<{ ownerCtx: Context; options: CreateAgentOptions }>
      resume: Array<{ ownerCtx: Context; options: ResumeAgentOptions }>
    } = { create: [], resume: [] }
    const factory: AgentFactory = {
      async createAgent(ownerCtx, options) {
        calls.create.push({ ownerCtx, options })
        return { agent: stubAgent(options.sessionId), dispose: () => Promise.resolve() }
      },
      async resume(ownerCtx, options) {
        calls.resume.push({ ownerCtx, options })
        return { agent: stubAgent(options.resumeSessionId), dispose: () => Promise.resolve() }
      },
    }
    return { factory, calls }
  }

  it('requires a factory and delegates through the calling context', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await expect(ctx.agents.create({ sessionId: SessionId('s') })).rejects.toThrow(/no agent factory/)
    const { factory, calls } = stubFactory()
    ctx.agents.setFactory(factory)

    let callerFiber: Context['fiber'] | undefined
    await ctx.plugin(Object.assign(async (inner: Context) => {
      callerFiber = inner.fiber
      await inner.agents.create({ sessionId: SessionId('create-s') })
      await inner.agents.resume({ resumeSessionId: SessionId('resume-s') })
    }, { inject: ['agents'] }))
    expect(calls.create[0]?.ownerCtx.fiber).toBe(callerFiber)
    expect(calls.resume[0]?.ownerCtx.fiber).toBe(callerFiber)
  })

  it.each([
    ['omitted', undefined, false],
    ['enabled', { forkFromSeed: true } as const, true],
    ['disabled', { forkFromSeed: false } as const, false],
  ])('reports the %s factory fork capability for its created session', async (
    _label,
    sessionCapabilities,
    expected,
  ) => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const sessionId = SessionId(`factory-capability-${String(expected)}-${String(sessionCapabilities?.forkFromSeed)}`)
    const { factory } = stubFactory()
    ctx.agents.setFactory({
      ...factory,
      ...(sessionCapabilities === undefined ? {} : { sessionCapabilities }),
      async createAgent(_ownerCtx, options) {
        const agent = stubAgent(options.sessionId)
        const detach = ctx.agents.enter(agent, undefined)
        return { agent, dispose: async () => { detach() } }
      },
    })

    await ctx.agents.create({ sessionId })

    expect(ctx.agents.sessionCapabilities(sessionId)?.forkFromSeed === true).toBe(expected)
  })

  it.each([
    ['omitted', undefined],
    ['disabled', { forkFromSeed: false } as const],
  ])('rejects seeded create before invoking a %s factory', async (_label, sessionCapabilities) => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const { factory, calls } = stubFactory()
    ctx.agents.setFactory({
      ...factory,
      ...(sessionCapabilities === undefined ? {} : { sessionCapabilities }),
    })
    const sessionId = SessionId(`seeded-create-${_label}`)

    const pending = ctx.agents.create({ sessionId, seed: [] })

    await expect(pending).rejects.toMatchObject({
      name: 'AgentFactoryCapabilityUnavailableError',
      capability: 'forkFromSeed',
    })
    await expect(pending).rejects.toBeInstanceOf(AgentFactoryCapabilityUnavailableError)
    expect(calls.create).toEqual([])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
  })

  it('allows seeded create through its captured capable factory', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const { factory, calls } = stubFactory()
    ctx.agents.setFactory({
      ...factory,
      sessionCapabilities: { forkFromSeed: true },
    })
    const sessionId = SessionId('seeded-create-enabled')
    const seed = [] as const

    await expect(ctx.agents.create({ sessionId, seed })).resolves.toBeDefined()

    expect(calls.create).toHaveLength(1)
    expect(calls.create[0]?.options.seed).toBe(seed)
  })

  it.each([
    ['create', (ctx: Context, id: SessionId) => ctx.agents.create({ sessionId: id })],
    ['resume', (ctx: Context, id: SessionId) => ctx.agents.resume({ resumeSessionId: id })],
  ])('rejects an ambient %s publication after its factory registration is replaced', async (
    _operation,
    invoke,
  ) => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const publish = async (id: SessionId) => {
      started.resolve(undefined)
      await release.promise
      const agent = stubAgent(id)
      const detach = ctx.agents.enter(agent, undefined)
      return { agent, dispose: async () => { detach() } }
    }
    const factory: AgentFactory = {
      sessionCapabilities: { forkFromSeed: true },
      createAgent: (_ownerCtx, options) => publish(options.sessionId),
      resume: (_ownerCtx, options) => publish(options.resumeSessionId),
    }
    const unregister = ctx.agents.setFactory(factory)
    const id = SessionId(`stale-ambient-${_operation}`)
    const pending = invoke(ctx, id)
    await started.promise
    unregister()
    ctx.agents.setFactory({
      ...stubFactory().factory,
      sessionCapabilities: { forkFromSeed: false },
    })

    release.resolve(undefined)

    await expect(pending).rejects.toThrow('agent factory registration is no longer active')
    expect(ctx.agents.get(id)).toBeUndefined()
    expect(ctx.agents.sessionCapabilities(SessionId('replacement-cold'))?.forkFromSeed).toBe(false)
  })

  it.each([
    ['create', (ctx: Context, id: SessionId) => ctx.agents.create({ sessionId: id })],
    ['resume', (ctx: Context, id: SessionId) => ctx.agents.resume({ resumeSessionId: id })],
  ])('invalidates ambient %s publication when the factory invocation settles', async (
    _operation,
    invoke,
  ) => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const release = Promise.withResolvers<undefined>()
    let detached!: Promise<void>
    const publishDetached = (id: SessionId) => {
      detached = (async () => {
        await release.promise
        ctx.agents.enter(stubAgent(`${id}-detached`), undefined)
      })()
      return Promise.resolve({ agent: stubAgent(id), dispose: () => Promise.resolve() })
    }
    ctx.agents.setFactory({
      sessionCapabilities: { forkFromSeed: true },
      createAgent: (_ownerCtx, options) => publishDetached(options.sessionId),
      resume: (_ownerCtx, options) => publishDetached(options.resumeSessionId),
    })
    const id = SessionId(`settled-ambient-${_operation}`)

    await invoke(ctx, id)
    const rejection = expect(detached).rejects.toThrow('agent factory invocation is no longer active')
    release.resolve(undefined)

    await rejection
    expect(ctx.agents.get(SessionId(`${id}-detached`))).toBeUndefined()
  })

  it('keeps an external direct entry fail-closed while a capable factory is active', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const { factory } = stubFactory()
    ctx.agents.setFactory({ ...factory, sessionCapabilities: { forkFromSeed: true } })
    const external = stubAgent('external-direct')

    const detach = ctx.agents.enter(external, undefined)

    expect(ctx.agents.sessionCapabilities(external.id)).toBeUndefined()
    detach()
  })

  it('accepts only the opaque exact registration for direct publication', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const { factory } = stubFactory()
    const registered = { ...factory, sessionCapabilities: { forkFromSeed: true } as const }
    const stale = { ...factory, sessionCapabilities: { forkFromSeed: false } as const }
    const registration = ctx.agents.setFactory(registered)

    expect(() => ctx.agents.enter(
      stubAgent('stale-direct'),
      undefined,
      stale as unknown as NonNullable<Parameters<AgentRegistry['enter']>[2]>,
    )).toThrow('agent factory publication is not the active registration')
    expect(ctx.agents.get(SessionId('stale-direct'))).toBeUndefined()
    const direct = stubAgent('registered-direct')
    const detach = ctx.agents.enter(direct, undefined, registration)

    expect(ctx.agents.sessionCapabilities(direct.id)?.forkFromSeed).toBe(true)
    detach()
  })

  it('requires the exact registration epoch when one factory object publishes directly', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const { factory } = stubFactory()
    const reused = { ...factory, sessionCapabilities: { forkFromSeed: true } as const }
    const registrationA = ctx.agents.setFactory(reused)
    registrationA()
    const registrationB = ctx.agents.setFactory(reused)
    const publicationId = SessionId('same-factory-registration-epoch')
    type Publication = NonNullable<Parameters<AgentRegistry['enter']>[2]>
    const untypedPluginValue = (value: unknown): Publication => value as Publication

    expect(() => ctx.agents.enter(
      stubAgent(publicationId),
      undefined,
      untypedPluginValue(registrationA),
    )).toThrow()
    expect(ctx.agents.get(publicationId)).toBeUndefined()
    expect(() => ctx.agents.enter(
      stubAgent(publicationId),
      undefined,
      untypedPluginValue(reused),
    )).toThrow('agent factory publication is not the active registration')
    expect(ctx.agents.get(publicationId)).toBeUndefined()

    const foreignCtx = new Context()
    await foreignCtx.plugin(AgentRegistry)
    const foreignRegistration = foreignCtx.agents.setFactory(stubFactory().factory)
    expect(() => ctx.agents.enter(
      stubAgent(publicationId),
      undefined,
      foreignRegistration,
    )).toThrow('agent factory publication is not the active registration')
    expect(ctx.agents.get(publicationId)).toBeUndefined()

    const direct = stubAgent(publicationId)
    const detach = ctx.agents.enter(direct, undefined, untypedPluginValue(registrationB))
    expect(ctx.agents.sessionCapabilities(direct.id)?.forkFromSeed).toBe(true)
    detach()
  })

  it('keeps the factory commit atomic across a reentrant capability getter', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const replacement = {
      ...stubFactory().factory,
      sessionCapabilities: { forkFromSeed: false } as const,
    }
    const reentrant = {
      ...stubFactory().factory,
      get sessionCapabilities() {
        ctx.agents.setFactory(replacement)
        return { forkFromSeed: true } as const
      },
    }

    expect(() => ctx.agents.setFactory(reentrant)).toThrow('an agent factory is already registered')
    expect(ctx.agents.sessionCapabilities(SessionId('reentrant-factory-cold'))?.forkFromSeed).toBe(false)
  })

  it('rechecks the publication epoch after a reentrant Agent context read', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const registrationA = ctx.agents.setFactory(stubFactory().factory)
    let registrationB: ReturnType<AgentRegistry['setFactory']> | undefined
    const id = SessionId('reentrant-publication-epoch')
    const stale = stubAgent(id)
    Object.defineProperty(stale, Context.filter, {
      get() {
        registrationA()
        registrationB = ctx.agents.setFactory(stubFactory().factory)
        return undefined
      },
    })

    expect(() => ctx.agents.enter(stale, undefined, registrationA))
      .toThrow('agent factory registration is no longer active')
    expect(ctx.agents.get(id)).toBeUndefined()

    const replacement = stubAgent(id)
    expect(registrationB).toBeDefined()
    const detach = ctx.agents.enter(replacement, undefined, registrationB)
    expect(ctx.agents.get(id)).toBe(replacement)
    detach()
  })

  it('rejects a second factory and clears the slot with its owner (HMR)', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      inner.agents.setFactory(stubFactory().factory)
      expect(() => inner.agents.setFactory(stubFactory().factory)).toThrow(/already registered/)
    }, { inject: ['agents'] }))
    await expect(ctx.agents.create({ sessionId: SessionId('before-s') })).resolves.toBeDefined()
    await owner.dispose()
    await expect(ctx.agents.create({ sessionId: SessionId('after-s') })).rejects.toThrow(/no agent factory/)
  })

  it('canonicalizes an already traced Service before tracing it for the caller', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const states = new WeakMap<object, string[]>()
    class TracedFactory extends Service implements AgentFactory {
      readonly sessionCapabilities = { forkFromSeed: true } as const
      constructor(inner: Context) {
        super(inner, 'tracedFactory')
        states.set(this, [])
      }
      private calls(): string[] {
        const original = (this as unknown as { [symbols.original]?: TracedFactory })[symbols.original] ?? this
        const calls = states.get(original)
        if (calls === undefined) throw new Error('factory receiver was not canonicalized')
        return calls
      }
      async createAgent(_ownerCtx: Context, options: CreateAgentOptions) {
        this.calls().push('create')
        return { agent: stubAgent(options.sessionId), dispose: () => Promise.resolve() }
      }
      async resume(_ownerCtx: Context, options: ResumeAgentOptions) {
        this.calls().push('resume')
        return { agent: stubAgent(options.resumeSessionId), dispose: () => Promise.resolve() }
      }
    }
    await ctx.plugin(TracedFactory)
    const traced = (ctx as Context & { tracedFactory: TracedFactory }).tracedFactory
    const registration = ctx.agents.setFactory(traced)
    await ctx.agents.create({ sessionId: SessionId('create-s') })
    await ctx.agents.resume({ resumeSessionId: SessionId('resume-s') })
    const direct = stubAgent('direct-s')
    const detach = ctx.agents.enter(direct, undefined, registration)
    const raw = (traced as unknown as { [symbols.original]?: TracedFactory })[symbols.original]
    expect(states.get(raw!)).toEqual(['create', 'resume'])
    expect(ctx.agents.sessionCapabilities(direct.id)?.forkFromSeed).toBe(true)
    detach()
  })
})
