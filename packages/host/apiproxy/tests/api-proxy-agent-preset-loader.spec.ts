/**
 * Keyless assembled admission proof: a real Loader tree mounts the Session and
 * Agent registries, a no-roster deployment fixture, and ApiProxyService. The
 * public fetch/SSE carrier must reject an unsupported preset without invoking
 * the factory or publishing a Host frame.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { type Agent, type AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import ApiProxyService, {
  InProcessApiClient,
  toFetchHandler,
  type HostFrame,
} from '@deepseek-ai/dsh-host-apiproxy'

let root: string | undefined
let context: Context | undefined
const observations = { factoryCreates: 0 }

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** No-roster deployment services required by the real ApiProxyService row. */
const RuntimeFixture = {
  name: 'no-roster-runtime-fixture',
  inject: ['agents', 'sessions'],
  apply(ctx: Context): void {
    observations.factoryCreates = 0
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
      saveSelection: () => Promise.resolve(),
    } as never)
    ctx.provide('attachments', {} as never)
    ctx.provide('directoryPicker', {} as never)
    ctx.provide('llm', {} as never)
    ctx.provide('subagents', {} as never)
    ctx.provide('sessionQuery', {} as never)
    ctx.provide('tools', {} as never)
    ctx.provide('workspaceRegistry', {
      list: () => [],
      archivedSessionIds: [],
    } as never)

    const factory: AgentFactory = {
      async createAgent(ownerCtx, options) {
        observations.factoryCreates++
        const session = ctx.sessions.create(options.sessionId, {
          ...options.meta === undefined ? {} : { meta: options.meta },
        })
        const agent = { id: session.id, session, status: 'idle' } as Agent
        const agentCtx = ownerCtx.extend({ agent })
        Object.assign(agent, { ctx: agentCtx })
        await options.setup?.(agentCtx)
        const unregister = ctx.agents.register(agent)
        return { agent, dispose: () => { unregister(); return Promise.resolve() } }
      },
      resume: () => Promise.reject(new Error('fixture has no persisted Sessions')),
    }
    ctx.effect(() => ctx.agents.setFactory(factory), 'no-roster-runtime-fixture.setFactory()')
  },
}

/** Boot the exact package exports through the vendored Loader and Include. */
async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-apiproxy-no-roster-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-user-questions'",
    "- name: 'no-roster-runtime-fixture'",
    "- name: '@deepseek-ai/dsh-host-apiproxy'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-user-questions', UserQuestionService],
    ['no-roster-runtime-fixture', RuntimeFixture],
    ['@deepseek-ai/dsh-host-apiproxy', ApiProxyService],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('no-roster preset admission through a real Loader composition', () => {
  it('returns the stable refusal without factory, Session, or Host-frame publication', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const client = new InProcessApiClient(toFetchHandler(loaded.apiProxy))
    const controller = new AbortController()
    const frames: HostFrame[] = []
    let opened!: () => void
    const ready = new Promise<void>((resolve) => { opened = resolve })
    const consume = (async () => {
      try {
        for await (const envelope of client.events.host({}, controller.signal, opened)) frames.push(envelope.payload)
      } catch (error: unknown) {
        if (!controller.signal.aborted) throw error
      }
    })()
    await ready

    const before = await client.sessions.list({})
    const response = await client.sessions.create({
      sessionId: 'unsupported-through-loader' as never,
      agentPreset: 'unsupported',
    })
    const after = await client.sessions.list({})
    controller.abort()
    await consume

    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'agent-preset-not-found',
        message: 'this deployment composes no agent presets',
        details: { agentPreset: 'unsupported', available: [] },
      },
    })
    expect(after.result).toEqual(before.result)
    expect(observations.factoryCreates).toBe(0)
    expect(frames).toEqual([])
  })
})
