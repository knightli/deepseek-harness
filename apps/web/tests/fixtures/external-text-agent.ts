/**
 * Loader-mounted deterministic AgentFactory for the assembled external-text
 * Host protocol snapshot.
 * @module external-text-agent-fixture
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  Inbox,
  emitAgentEvent,
  type Agent,
  type AgentCancelCause,
  type AgentFactory,
  type AgentHandle,
  type CancelOptions,
  type CreateAgentOptions,
  type InboxTarget,
  type ResumeAgentOptions,
  type SessionStartSource,
} from '@deepseek-ai/dsh-agent'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import {
  SessionPreparation,
  type Session,
  type UserMessage,
} from '@deepseek-ai/dsh-session'
import {
  CREATE_QUEUE_REPLY,
  CREATE_STEER_REPLY,
  EXTERNAL_MODEL,
  EXTERNAL_PROVIDER,
  RESUME_QUEUE_REPLY,
  type ExternalTextAgentTrace,
} from './external-text-agent-contract.ts'

const trace: ExternalTextAgentTrace[] = []

/** Clear process-local fixture observations before one assembled scenario. */
export function resetExternalTextAgentTrace(): void {
  trace.length = 0
}

/** Return a detached copy of fixture observations for protocol assertions. */
export function externalTextAgentTrace(): ExternalTextAgentTrace[] {
  return structuredClone(trace)
}

/** Fixture plugin name. */
export const name = 'external-text-agent-fixture'
/** Services required by both fresh creation and persisted resume. */
export const inject = ['agents', 'sessions', 'sessionPersistence']

type DisposeHandle = () => Promise<void>

function textOf(message: UserMessage): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function nextTurnOf(session: Session): number {
  return session.events.reduce((maximum, event) => {
    if (event.type !== 'turn/start') return maximum
    return Math.max(maximum, event.data.turn)
  }, 0) + 1
}

function replyFor(source: SessionStartSource, target: InboxTarget): string {
  if (source === 'resume') return RESUME_QUEUE_REPLY
  return target === 'next-step' ? CREATE_STEER_REPLY : CREATE_QUEUE_REPLY
}

async function publishAgent(
  ctx: Context,
  ownerCtx: Context,
  preparation: SessionPreparation,
  options: CreateAgentOptions | ResumeAgentOptions,
  source: SessionStartSource,
  liveHandles: Set<DisposeHandle>,
): Promise<AgentHandle> {
  const session = preparation.session
  const agent = {} as Agent
  const scope = createScope(ctx, agent)
  const agentCtx = scope.ctx.extend({ agent })
  if (scopeOf(agentCtx) === undefined) throw new Error('external Agent fixture failed to mint its agent scope')
  const inbox = new Inbox(session, {
    inserted: (message) => { emitAgentEvent(ctx, agent, 'agent/inbox/inserted', { message }) },
    discarded: (message) => { emitAgentEvent(ctx, agent, 'agent/inbox/discarded', { message }) },
    claimed: (message, turn) => { emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message, turn }) },
  })
  let nextTurn = nextTurnOf(session)
  let idle = Promise.resolve()

  const drive = (message: UserMessage, target: InboxTarget): void => {
    trace.push({ kind: 'deliver', source, target, text: textOf(message) })
    inbox.append(target, message)
    const turn = nextTurn++
    session.append('turn/start', { turn })
    const claimed = inbox.claim(target, turn)
    session.append('step/start', { turn, step: 1 })
    for (const item of claimed) {
      session.append('user/message', item, { surfaceOp: 'append' })
    }
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: replyFor(source, target) }],
        source: { provider: EXTERNAL_PROVIDER, model: EXTERNAL_MODEL },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
    idle = ctx.sessions.flush(session).then(() => undefined)
  }

  Object.assign(agent, {
    id: session.id,
    options: {
      ...options.agentOptions,
      provider: EXTERNAL_PROVIDER,
      model: EXTERNAL_MODEL,
    },
    promptExecution: { kind: 'external-text' },
    session,
    inbox,
    status: 'idle',
    ctx: agentCtx,
    cancel: (cause: AgentCancelCause, cancelOptions?: CancelOptions) => {
      trace.push({ kind: 'cancel', source, cause: cause.kind })
      if (cancelOptions?.keepInbox !== true) inbox.clear()
    },
    whenIdle: () => idle,
    runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal),
    send: (message: UserMessage, target: InboxTarget, wakeup: boolean) => {
      if (wakeup) drive(message, target)
      else inbox.append(target, message)
    },
    followup: (message: UserMessage) => { drive(message, 'next-turn') },
    steer: (message: UserMessage) => { drive(message, 'next-step') },
    inject: (message: UserMessage) => { inbox.append('next-step', message) },
  } satisfies Partial<Agent>)

  let detachSession: (() => void) | undefined
  let detachAgent: (() => void) | undefined
  let unfollowOwner: (() => Promise<void> | void) | undefined
  let disposed: Promise<void> | undefined
  const dispose = (ownerTriggered = false): Promise<void> => {
    disposed ??= (async () => {
      agent.cancel({ kind: 'disposed' })
      await agent.whenIdle()
      await scope.dispose()
      detachAgent?.()
      detachSession?.()
      liveHandles.delete(publicDispose)
      if (!ownerTriggered) await unfollowOwner?.()
    })()
    return disposed
  }
  const publicDispose = (): Promise<void> => dispose()

  try {
    unfollowOwner = ownerCtx.effect(() => () => {
      if (disposed !== undefined) return
      return dispose(true)
    }, `external-text-agent-fixture.lifecycle(${agent.id})`)
    liveHandles.add(publicDispose)

    const commit = await options.setup?.(agentCtx)
    options.signal?.throwIfAborted()
    commit?.commit()

    detachSession = agentCtx.sessions.enter(session)
    detachAgent = ctx.agents.enter(agent, ownerCtx.agent)
    agentCtx.sessions.announce(session)
    ctx.agents.announce(agent)
    emitAgentEvent(ctx, agent, 'agent/session-start', { source })
    return { agent, dispose: publicDispose }
  } catch (error: unknown) {
    await publicDispose()
    throw error
  }
}

function fixtureFactory(ctx: Context, liveHandles: Set<DisposeHandle>): AgentFactory {
  return {
    async createAgent(ownerCtx, options) {
      options.signal?.throwIfAborted()
      trace.push({ kind: 'create', sessionId: options.sessionId })
      using preparation = SessionPreparation.create(ctx.sessions.prepare(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: options.seed },
        ...options.meta === undefined ? {} : { meta: options.meta },
      }))
      return await publishAgent(ctx, ownerCtx, preparation, options, 'startup', liveHandles)
    },

    async resume(ownerCtx, options) {
      options.signal?.throwIfAborted()
      trace.push({ kind: 'resume', sessionId: options.resumeSessionId })
      using preparation = await ctx.sessionPersistence.prepare(options.resumeSessionId, options.signal)
      return await publishAgent(ctx, ownerCtx, preparation, options, 'resume', liveHandles)
    },
  }
}

/**
 * Install the fixture factory through the public AgentRegistry seam.
 * @param ctx - Loader-owned assembled Web context.
 */
export function apply(ctx: Context): void {
  const liveHandles = new Set<DisposeHandle>()
  ctx.effect(() => {
    const unsetFactory = ctx.agents.setFactory(fixtureFactory(ctx, liveHandles))
    return async () => {
      await Promise.all([...liveHandles].map(dispose => dispose()))
      unsetFactory()
    }
  }, 'external-text-agent-fixture.setFactory()')
}
