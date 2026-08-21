/** Assembled Web snapshot for a Loader-mounted external-text AgentFactory. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import {
  CREATE_QUEUE_REPLY,
  CREATE_STEER_REPLY,
  EXTERNAL_MODEL,
  EXTERNAL_PROVIDER,
  RESUME_QUEUE_REPLY,
} from './fixtures/external-text-agent-contract.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/external-text-agent', import.meta.url))
const PROTOCOL_EXPECTED = join(SNAPSHOT_DIR, 'protocol.expected.json')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const FORK_REJECTION_EXPECTED = join(SNAPSHOT_DIR, 'fork-rejection.expected.md')
const EXTERNAL_OVERLAY = fileURLToPath(new URL('./external-text-agent.overlay.yml', import.meta.url))
const STOCK_OVERLAY = fileURLToPath(new URL('./external-text-agent-stock.overlay.yml', import.meta.url))
const MODE = webSnapshotMode()

const SESSION_ID = 'external-text-agent-snapshot'
const SESSION_TITLE = 'External text agent snapshot'
const CREATE_QUEUE_PROMPT = 'external create queue prompt'
const CREATE_STEER_PROMPT = 'external create steer prompt'
const RESUME_QUEUE_PROMPT = 'external resume queue prompt'

type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: unknown } }

interface HistoryPage {
  events: Array<{ event: SessionEvent }>
  hasMore: boolean
}

interface ModelsValue {
  current: { provider: string; model: string }
  routable: boolean
  capabilities: { imageInput: boolean; modelSelection: boolean; fork: boolean }
  groups: Array<{ id: string }>
  failures: unknown[]
}

interface SessionListValue {
  items: Array<{ sessionId: string }>
}

let rpcOrdinal = 0

async function rpc<T>(baseUrl: string, method: string, payload: unknown): Promise<RpcResult<T>> {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `external-text-snapshot-${String(++rpcOrdinal)}`,
      method,
      payload,
    }),
  })
  expect(response.status, `${method} HTTP status`).toBe(200)
  return (await response.json() as { result: RpcResult<T> }).result
}

function ok<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

function messageText(content: readonly { type: string; text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('')
}

function projectHistory(history: HistoryPage): unknown[] {
  return history.events.flatMap(({ event }): unknown[] => {
    switch (event.type) {
      case 'agent/inbox/spliced':
        return [{
          type: event.type,
          target: event.data.target,
          inserted: event.data.inserted.map(message => messageText(message.content)),
          ...event.data.removedCount === undefined ? {} : { removedCount: event.data.removedCount },
          ...event.data.outcome === undefined ? {} : { outcome: event.data.outcome },
        }]
      case 'turn/start':
        return [{ type: event.type, turn: event.data.turn }]
      case 'step/start':
      case 'step/end':
        return [{ type: event.type, turn: event.data.turn, step: event.data.step }]
      case 'user/message':
        return [{
          type: event.type,
          text: messageText(event.data.content),
          source: event.data.source.kind,
        }]
      case 'assistant/message':
        return [{
          type: event.type,
          turn: event.data.turn,
          step: event.data.step,
          text: messageText(event.data.message.content),
        }]
      case 'turn/end':
        return [{ type: event.type, turn: event.data.turn, reason: event.data.reason }]
      default:
        return []
    }
  })
}

function projectModels(value: ModelsValue): unknown {
  return {
    current: value.current,
    routable: value.routable,
    capabilities: value.capabilities,
    externalProviderListed: value.groups.some(group => group.id === EXTERNAL_PROVIDER),
    failures: value.failures,
  }
}

function normalizeRawHistory(history: HistoryPage): unknown[] {
  return history.events.map(({ event }) => ({ event: { ...event, time: '{{timestamp}}' } }))
}

async function promptAndSettle(
  scaffold: WebScaffold,
  mode: 'queue' | 'steer',
  text: string,
): Promise<RpcResult<{ accepted: true }>> {
  const settled = scaffold.whenTurnSettled()
  const result = await rpc<{ accepted: true }>(scaffold.baseUrl, 'session.prompt', {
    sessionId: SESSION_ID,
    mode,
    content: [{ type: 'text', text }],
  })
  if (result.ok) await settled
  return result
}

describe('web e2e: external Agent text admission through the shipped application', () => {
  let workspaceRoot: string
  let persistenceRoot: string
  let workspacePath: string
  let harnessHome: string
  let liveScaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page | undefined

  beforeAll(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-web-external-agent-ws-'))
    persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-web-external-agent-sessions-'))
    workspacePath = join(workspaceRoot, 'external-workspace')
    harnessHome = join(workspaceRoot, '.dsh-home')
    await mkdir(workspacePath, { recursive: true })
    await mkdir(SNAPSHOT_DIR, { recursive: true })
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await liveScaffold?.close().catch((error: unknown) => failures.push(error))
    await rm(workspaceRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    await rm(persistenceRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'external Agent snapshot teardown failed')
  })

  it('keeps stock admission closed and resumes the external Agent across a real Host restart', async () => {
    const stock = await launchWebScaffold({ extraOverlayPath: STOCK_OVERLAY })
    const stockSessionId = 'external-text-stock-regression'
    let stockProtocol: unknown
    try {
      ok(await rpc(stock.baseUrl, 'session.create', {
        sessionId: stockSessionId,
        cwd: stock.workspaceCwd,
      }))
      const stockModels = ok(await rpc<ModelsValue>(stock.baseUrl, 'session.models', {
        sessionId: stockSessionId,
      }))
      const stockHistoryBefore = ok(await rpc<HistoryPage>(stock.baseUrl, 'session.history', {
        sessionId: stockSessionId,
        maxMessages: 10,
      }))
      const stockPrompt = await rpc(stock.baseUrl, 'session.prompt', {
        sessionId: stockSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'must remain refused' }],
      })
      const stockHistoryAfterPrompt = ok(await rpc<HistoryPage>(stock.baseUrl, 'session.history', {
        sessionId: stockSessionId,
        maxMessages: 10,
      }))
      const stockSelectModel = await rpc(stock.baseUrl, 'session.selectModel', {
        sessionId: stockSessionId,
        provider: EXTERNAL_PROVIDER,
        model: EXTERNAL_MODEL,
      })
      const stockHistoryAfterSelectModel = ok(await rpc<HistoryPage>(stock.baseUrl, 'session.history', {
        sessionId: stockSessionId,
        maxMessages: 10,
      }))
      expect(stockModels.current).toEqual({ provider: EXTERNAL_PROVIDER, model: EXTERNAL_MODEL })
      expect(stockModels.routable).toBe(false)
      expect(stockPrompt).toEqual({
        ok: false,
        error: {
          code: 'model-unavailable',
          message: `no adapter serves provider "${EXTERNAL_PROVIDER}"; select a model for this session`,
          details: { provider: EXTERNAL_PROVIDER, model: EXTERNAL_MODEL },
        },
      })
      expect(stockSelectModel).toEqual({
        ok: false,
        error: {
          code: 'model-unavailable',
          message: `no adapter registered for provider "${EXTERNAL_PROVIDER}"`,
          details: { provider: EXTERNAL_PROVIDER, model: EXTERNAL_MODEL },
        },
      })
      expect(stockHistoryAfterPrompt.events).toEqual(stockHistoryBefore.events)
      expect(stockHistoryAfterSelectModel.events).toEqual(stockHistoryBefore.events)
      stockProtocol = {
        models: projectModels(stockModels),
        prompt: stockPrompt,
        selectModel: stockSelectModel,
        historyBefore: normalizeRawHistory(stockHistoryBefore),
        historyAfterPrompt: normalizeRawHistory(stockHistoryAfterPrompt),
        historyAfterSelectModel: normalizeRawHistory(stockHistoryAfterSelectModel),
      }
    } finally {
      await stock.close()
    }

    const first = await launchWebScaffold({
      workspaceCwd: workspaceRoot,
      persistenceRoot,
      harnessHome,
      extraOverlayPath: EXTERNAL_OVERLAY,
      externalTextAgentFixture: true,
      resetExternalTextAgentTrace: true,
    })
    liveScaffold = first

    const workspace = ok(await rpc<{
      workspace: { workspaceId: string; path: string; title: string }
      created: boolean
    }>(first.baseUrl, 'workspace.create', { path: workspacePath }))
    const created = await rpc<{ sessionId: string }>(first.baseUrl, 'session.create', {
      workspaceId: workspace.workspace.workspaceId,
      sessionId: SESSION_ID,
    })
    expect(created).toEqual({ ok: true, value: { sessionId: SESSION_ID, agentPreset: 'standard' } })

    const createModels = ok(await rpc<ModelsValue>(first.baseUrl, 'session.models', { sessionId: SESSION_ID }))
    const selectModel = await rpc(first.baseUrl, 'session.selectModel', {
      sessionId: SESSION_ID,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    const createQueue = await promptAndSettle(first, 'queue', CREATE_QUEUE_PROMPT)
    const createSteer = await promptAndSettle(first, 'steer', CREATE_STEER_PROMPT)
    const cancel = await rpc(first.baseUrl, 'session.cancel', { sessionId: SESSION_ID })
    const renamed = await rpc<{ title: string; seq: number }>(first.baseUrl, 'session.rename', {
      sessionId: SESSION_ID,
      title: SESSION_TITLE,
    })
    const beforeRestart = ok(await rpc<HistoryPage>(first.baseUrl, 'session.history', {
      sessionId: SESSION_ID,
      maxMessages: 20,
    }))
    expect(createModels.current).toEqual({ provider: EXTERNAL_PROVIDER, model: EXTERNAL_MODEL })
    expect(createModels.routable).toBe(true)
    expect(createModels.groups.some(group => group.id === EXTERNAL_PROVIDER)).toBe(false)
    expect(selectModel).toMatchObject({ ok: false, error: { code: 'model-unavailable' } })
    expect(createQueue).toEqual({ ok: true, value: { accepted: true } })
    expect(createSteer).toEqual({ ok: true, value: { accepted: true } })
    expect(cancel).toEqual({ ok: true, value: { accepted: true } })

    await first.close()
    liveScaffold = undefined

    const second = await launchWebScaffold({
      workspaceCwd: workspaceRoot,
      persistenceRoot,
      harnessHome,
      extraOverlayPath: EXTERNAL_OVERLAY,
      externalTextAgentFixture: true,
      // The first Host persisted the acknowledgement in this borrowed home;
      // do not issue a redundant second atomic settings write during restart.
      welcomeNoticePending: true,
    })
    liveScaffold = second
    const resumeModels = ok(await rpc<ModelsValue>(second.baseUrl, 'session.models', { sessionId: SESSION_ID }))
    const resumeQueue = await promptAndSettle(second, 'queue', RESUME_QUEUE_PROMPT)
    const afterRestart = ok(await rpc<HistoryPage>(second.baseUrl, 'session.history', {
      sessionId: SESSION_ID,
      maxMessages: 30,
    }))
    expect(resumeModels.current).toEqual({ provider: EXTERNAL_PROVIDER, model: EXTERNAL_MODEL })
    expect(resumeModels.routable).toBe(true)
    expect(resumeQueue).toEqual({ ok: true, value: { accepted: true } })
    expect(projectHistory(afterRestart)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant/message', text: CREATE_QUEUE_REPLY }),
      expect.objectContaining({ type: 'assistant/message', text: CREATE_STEER_REPLY }),
      expect.objectContaining({ type: 'assistant/message', text: RESUME_QUEUE_REPLY }),
    ]))

    const protocol = {
      external: {
        workspace: { created: workspace.created, path: '{{workspace}}', title: workspace.workspace.title },
        createModels: projectModels(createModels),
        selectModel,
        createQueue,
        createSteer,
        cancel,
        renamed: renamed.ok ? { ok: true, value: { title: renamed.value.title } } : renamed,
        beforeRestart: projectHistory(beforeRestart),
        resumeModels: projectModels(resumeModels),
        resumeQueue,
        afterRestart: projectHistory(afterRestart),
        factoryTrace: second.externalTextAgentTrace().map(entry => (
          'sessionId' in entry ? { ...entry, sessionId: '{{sessionId}}' } : entry
        )),
      },
      stock: stockProtocol,
    }
    await compareOrRefreshGolden(PROTOCOL_EXPECTED, JSON.stringify(protocol, null, 2), MODE)

    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await newEnglishPage(browser)
    const activePage = page
    const tripwire = watchConsole(page)
    onTestFailed(() => page === undefined
      ? undefined
      : saveFailureShot(page, 'web-e2e-external-text-agent'))
    await page.goto(second.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const titledSession = page.getByText(SESSION_TITLE, { exact: true }).first()
    await titledSession.waitFor({ timeout: 20_000 })
    await titledSession.click()
    await page.getByText(RESUME_QUEUE_REPLY, { exact: true }).waitFor({ timeout: 20_000 })

    // This external AgentFactory declines ordinary Session forks. Drive the
    // shipped row menu through the real Host carrier and native workspace
    // surface: both attempts must announce the stable local rejection, while
    // Host Session/history state and the current selection remain unchanged.
    const beforeForkList = ok(await rpc<SessionListValue>(second.baseUrl, 'session.list', {}))
    const beforeForkHistory = ok(await rpc<HistoryPage>(second.baseUrl, 'session.history', {
      sessionId: SESSION_ID,
      maxMessages: 30,
    }))
    const sessionRow = page.getByRole('treeitem').filter({ hasText: SESSION_TITLE }).first()
    const selectedBeforeFork = await sessionRow.getAttribute('aria-selected')
    expect(selectedBeforeFork).toBe('true')
    expect(await page.locator('[role="treeitem"][aria-selected="true"]').count()).toBe(1)
    const treeItemCountBeforeFork = await page.getByRole('treeitem').count()
    const forkThroughNativeMenu = async (): Promise<unknown> => {
      const forkResponse = activePage.waitForResponse(response => (
        new URL(response.url()).pathname === '/api/session.fork'
        && response.request().method() === 'POST'
      ))
      await sessionRow.hover()
      await sessionRow.getByRole('button', {
        name: `Session actions for ${SESSION_TITLE}`,
      }).click()
      await activePage.getByRole('menuitem', { name: 'Fork session', exact: true }).click()
      const response = await forkResponse
      return (await response.json() as { result: unknown }).result
    }

    const firstForkResult = await forkThroughNativeMenu()
    expect(firstForkResult).toMatchObject({
      ok: false,
      error: { code: 'fork-unavailable', details: { sessionId: SESSION_ID } },
    })
    const forkAlert = page.getByRole('alert').filter({ hasText: 'Couldn’t fork this session.' })
    await forkAlert.waitFor({ timeout: 10_000 })
    const firstAlertHandle = await forkAlert.elementHandle()
    if (firstAlertHandle === null) throw new Error('first fork rejection alert did not mount')

    const secondForkResult = await forkThroughNativeMenu()
    expect(secondForkResult).toEqual(firstForkResult)
    await page.waitForFunction(alert => !alert.isConnected, firstAlertHandle)
    await forkAlert.waitFor({ timeout: 10_000 })
    const refusalAria = await captureStableAria(page, '[role="alert"]', second.workspaceCwd)
    await compareOrRefreshGolden(FORK_REJECTION_EXPECTED, refusalAria, MODE)

    const afterForkList = ok(await rpc<SessionListValue>(second.baseUrl, 'session.list', {}))
    const afterForkHistory = ok(await rpc<HistoryPage>(second.baseUrl, 'session.history', {
      sessionId: SESSION_ID,
      maxMessages: 30,
    }))
    expect(afterForkList.items.map(item => item.sessionId))
      .toEqual(beforeForkList.items.map(item => item.sessionId))
    expect(afterForkHistory.events).toEqual(beforeForkHistory.events)
    expect(await sessionRow.getAttribute('aria-selected')).toBe(selectedBeforeFork)
    expect(await page.locator('[role="treeitem"][aria-selected="true"]').count()).toBe(1)
    expect(await page.getByRole('treeitem').count()).toBe(treeItemCountBeforeFork)
    expect(await page.getByText('fork is unavailable for this session', { exact: false }).count()).toBe(0)
    // Keep the existing stable UI golden free of a transient banner.
    await forkAlert.waitFor({ state: 'detached', timeout: 6_000 })

    expect(await page.getByText(CREATE_QUEUE_REPLY, { exact: true }).count()).toBeGreaterThanOrEqual(1)
    expect(await page.getByText(CREATE_STEER_REPLY, { exact: true }).count()).toBeGreaterThanOrEqual(1)
    await page.locator('textarea:enabled').first().waitFor({ timeout: 10_000 })
    const ui = await captureStableAria(page, '[class*="frame"]', second.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, ui, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'fork-rejection.expected.md',
      'protocol.expected.json',
      'ui.expected.md',
    ])
  }, 180_000)
})
