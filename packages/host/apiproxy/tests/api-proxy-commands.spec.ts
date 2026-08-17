/** Slash-command admission through the public session.prompt wire. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`commands-${String(nextRpc++)}`), payload }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(UserQuestionService)
  const session = ctx.sessions.create(SessionId('command-session'), { meta: { cwd: '/tmp' } })
  const followup = vi.fn()
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
    followup,
  } as unknown as Agent
  ctx.agents.register(agent)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
    cwd: '/tmp',
  })
  return { ctx, session, followup, api }
}

async function coldHarness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(UserQuestionService)
  const sessionId = SessionId('cold-command-session')
  const meta: SessionHeader = {
    version: 0,
    id: sessionId,
    createdAt: 1_000,
    cwd: '/tmp',
  }
  const events: SessionEvent[] = []
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([meta]),
    inspect: () => Promise.resolve({ meta, events }),
    locate: () => undefined,
  } as never)
  const followup = vi.fn()
  const resume = vi.fn<AgentFactory['resume']>(async (_ownerCtx, options) => {
    const session = ctx.sessions.create(options.resumeSessionId, {
      seed: events,
      meta: {
        ...meta.cwd === undefined ? {} : { cwd: meta.cwd },
        createdAt: meta.createdAt,
      },
    })
    const agent = {
      id: session.id,
      session,
      status: 'idle',
      ctx,
      inbox: { nextTurn: [], nextStep: [] },
      followup,
    } as unknown as Agent
    const agentCtx = ctx.extend({ agent })
    ;(agent as { ctx: Context }).ctx = agentCtx
    const commit = await options.setup?.(agentCtx)
    commit?.commit()
    const unregister = ctx.agents.register(agent)
    return { agent, dispose: async () => { unregister() } }
  })
  const factory: AgentFactory = {
    createAgent: () => Promise.reject(new Error('not used')),
    resume,
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
    cwd: '/tmp',
    coldBlankProbeMaxBytes: 0,
  })
  return { ctx, sessionId, followup, resume, api }
}

describe('sessions.prompt slash admission', () => {
  it('rejects a definite unknown cold command before Agent resume or Session mutation', async () => {
    const { ctx, sessionId, resume, api } = await coldHarness()
    const before = await api.sessions.list(request({}))

    const response = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: '/permission danger-full-access' }],
    }))
    const after = await api.sessions.list(request({}))

    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'unknown-command',
        message: 'unknown command "/permission"',
        details: {},
      },
    })
    expect(resume).not.toHaveBeenCalled()
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    expect(JSON.stringify(after.result)).toBe(JSON.stringify(before.result))
    await ctx.fiber.dispose()
  })

  it('resumes a cold Session for a registered command and keeps the stock lifecycle', async () => {
    const { ctx, sessionId, followup, resume, api } = await coldHarness()
    ctx.commands.register({
      name: 'known',
      description: 'Known command',
      handler: () => ({ kind: 'success', text: 'command complete' }),
    })

    const response = await api.sessions.prompt(request({
      sessionId,
      mode: 'steer' as const,
      content: [{ type: 'text' as const, text: '/known exact input' }],
    }))

    expect(response.result).toEqual({
      ok: true,
      value: { accepted: true, command: { kind: 'success', text: 'command complete' } },
    })
    expect(resume).toHaveBeenCalledOnce()
    expect(followup).not.toHaveBeenCalled()
    expect(ctx.sessions.get(sessionId)?.events
      .filter(event => event.type === 'command/run' || event.type === 'command/done')
      .map(event => event.type))
      .toEqual(['command/run', 'command/done'])
    await ctx.fiber.dispose()
  })

  it('rejects an unknown single-block command without entering the Agent or Session log', async () => {
    const { ctx, session, followup, api } = await harness()

    const response = await api.sessions.prompt(request({
      sessionId: session.id,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: '/permission danger-full-access' }],
    }))

    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'unknown-command',
        message: 'unknown command "/permission"',
        details: {},
      },
    })
    expect(followup).not.toHaveBeenCalled()
    expect(session.events).toEqual([])
    await ctx.fiber.dispose()
  })

  it('executes a registered command in the command plane and never routes it to the Agent', async () => {
    const { ctx, session, followup, api } = await harness()
    ctx.commands.register({
      name: 'known',
      description: 'Known command',
      handler: () => ({ kind: 'success', text: 'command complete' }),
    })

    const response = await api.sessions.prompt(request({
      sessionId: session.id,
      mode: 'steer' as const,
      content: [{ type: 'text' as const, text: '/known exact input' }],
    }))

    expect(response.result).toEqual({
      ok: true,
      value: { accepted: true, command: { kind: 'success', text: 'command complete' } },
    })
    expect(followup).not.toHaveBeenCalled()
    expect(session.events.map(event => event.type)).toEqual(['command/run', 'command/done'])
    await ctx.fiber.dispose()
  })

  it.each([
    ['leading whitespace', [{ type: 'text' as const, text: ' /known' }]],
    ['multiple blocks', [{ type: 'text' as const, text: '/known' }, { type: 'text' as const, text: 'body' }]],
  ])('keeps %s input on the ordinary Agent prompt path', async (_label, content) => {
    const { ctx, session, followup, api } = await harness()
    ctx.commands.register({
      name: 'known',
      description: 'Known command',
      handler: () => ({ kind: 'success' }),
    })

    const response = await api.sessions.prompt(request({ sessionId: session.id, mode: 'queue' as const, content }))

    expect(response.result).toEqual({ ok: true, value: { accepted: true } })
    expect(followup).toHaveBeenCalledOnce()
    expect(session.events).toEqual([])
    await ctx.fiber.dispose()
  })
})
