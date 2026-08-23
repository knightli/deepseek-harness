#!/usr/bin/env node
/** Boot the real Loader composition and print its public Session authority transcript. */

import type { Context } from '@deepseek-ai/cordis'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import type { SessionId } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('session-authority driver requires a config path')

const sessionId = 'session-authority-snapshot' as SessionId
const request = <T>(rpcId: string, payload: T) => ({ rpcId: RpcId(rpcId), payload })
let ctx: Context | undefined
try {
  ctx = await boot('session-authority-snapshot', resolveConfigPath(configPath, undefined))
  const history = await ctx.apiProxy.sessions.history(request('history', { sessionId }))
  if (!history.result.ok) throw new Error(history.result.error.message)
  process.stdout.write(`${JSON.stringify({
    history: history.result.value.events.map(entry => entry.event.type),
  })}\n`)
  const rename = await ctx.apiProxy.sessions.rename(request('rename', {
    sessionId,
    title: '  DSH   accepted title  ',
  }))
  process.stdout.write(`${JSON.stringify(rename.result)}\n`)
  process.stdout.write(`${JSON.stringify({ title: ctx.sessionTitle.get(ctx.agents.get(sessionId)!.session)?.title })}\n`)
} finally {
  await ctx?.fiber.dispose()
}
