/** Keyless provider fixture for the assembled external Session authority snapshot. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionTitleAuthorityId } from '@deepseek-ai/dsh-session-title'

const SESSION_ID = SessionId('session-authority-snapshot')

/** Services that the real ApiProxy composition requires but this focused fixture never calls. */
const UNUSED_SERVICES = [
  'attachments',
  'directoryPicker',
  'llm',
  'subagents',
  'sessionQuery',
  'tools',
  'workspaceRegistry',
] as const

/** Mount one live Session and an exact external authority into the real gateway composition. */
export function apply(ctx: Context): void {
  const session = ctx.sessions.create(SESSION_ID, { meta: { cwd: process.cwd() } })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'original prompt' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)

  const provide = ctx.provide.bind(ctx) as (name: string, value: unknown) => () => void
  ctx.effect(() => {
    const removers = UNUSED_SERVICES.map(name => provide(name, {}))
    removers.push(provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'fixture', model: 'fixture' }),
      saveSelection: () => Promise.resolve(),
    }))
    let refreshed = false
    removers.push(provide('sessionAuthority', {
      async refresh(sessionId: typeof SESSION_ID) {
        if (sessionId !== SESSION_ID || refreshed) return
        refreshed = true
        session.append('turn/start', { turn: 2 })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'advanced by external Host' }],
          source: { kind: 'plugin', plugin: 'session-authority-snapshot' },
        }), { surfaceOp: 'append' })
        session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
        ctx.sessionTitle.projectExternal(
          session,
          'Native authority title',
          SessionTitleAuthorityId('snapshot-native'),
        )
      },
      async rename(sessionId: typeof SESSION_ID, title: string) {
        if (sessionId !== SESSION_ID) return undefined
        return { title, authority: SessionTitleAuthorityId('snapshot-native') }
      },
    }))
    return () => {
      for (const remove of removers.reverse()) remove()
    }
  }, 'session-authority-snapshot.providers')
}

export const inject = ['agents', 'sessions', 'sessionTitle']
