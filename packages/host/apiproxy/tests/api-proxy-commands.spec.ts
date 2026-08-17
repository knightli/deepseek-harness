/** Slash-command admission through the public session.prompt wire. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
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

describe('sessions.prompt slash admission', () => {
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
