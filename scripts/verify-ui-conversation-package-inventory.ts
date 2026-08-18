/** Verify the actual packed ui-conversation artifact against the official member inventory. */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEntry, run } from './release/process.ts'
import { tarballFiles } from './release/tarball.ts'

const UI_CONVERSATION_ROOT = fileURLToPath(new URL('../packages/client/ui-conversation/', import.meta.url))

/** Exact members published by the official ui-conversation package. */
export const OFFICIAL_UI_CONVERSATION_PACKAGE_FILES = [
  'package/LICENSE',
  'package/README.i18n.yaml',
  'package/README.md',
  'package/README.zh.md',
  'package/lib/client.js',
  'package/lib/index.js',
  'package/lib/invariant.js',
  'package/lib/types/client/apply.d.ts',
  'package/lib/types/client/chat/AssistantMarkdown.d.ts',
  'package/lib/types/client/chat/AssistantNodeView.d.ts',
  'package/lib/types/client/chat/ChatNodeSeat.d.ts',
  'package/lib/types/client/chat/ChatView.d.ts',
  'package/lib/types/client/chat/CommandNodeView.d.ts',
  'package/lib/types/client/chat/CompactionCommandCard.d.ts',
  'package/lib/types/client/chat/CompactionItem.d.ts',
  'package/lib/types/client/chat/ContextBody.d.ts',
  'package/lib/types/client/chat/ContextInjectionRow.d.ts',
  'package/lib/types/client/chat/GenericCommandCard.d.ts',
  'package/lib/types/client/chat/MessageIconActions.d.ts',
  'package/lib/types/client/chat/MessageItem.d.ts',
  'package/lib/types/client/chat/ReasoningRow.d.ts',
  'package/lib/types/client/chat/StatsLine.d.ts',
  'package/lib/types/client/chat/TurnTailNodeView.d.ts',
  'package/lib/types/client/chat/message-chrome.d.ts',
  'package/lib/types/client/chat/register-node-renderers.d.ts',
  'package/lib/types/client/chat/tool-node-reader.d.ts',
  'package/lib/types/client/chat/turn-assistant.d.ts',
  'package/lib/types/client/chat/turn-metrics.d.ts',
  'package/lib/types/client/chat/use-calendar-day.d.ts',
  'package/lib/types/client/chat/use-throttled-visual-update.d.ts',
  'package/lib/types/client/contract/chat-nodes.d.ts',
  'package/lib/types/client/contract/composer-submission.d.ts',
  'package/lib/types/client/contract/queue.d.ts',
  'package/lib/types/client/contract/slots.d.ts',
  'package/lib/types/client/contract/views.d.ts',
  'package/lib/types/client/conversation-nodes/assistant.d.ts',
  'package/lib/types/client/conversation-nodes/chat-snapshot-builder.d.ts',
  'package/lib/types/client/conversation-nodes/command.d.ts',
  'package/lib/types/client/conversation-nodes/common.d.ts',
  'package/lib/types/client/conversation-nodes/compaction.d.ts',
  'package/lib/types/client/conversation-nodes/fallback.d.ts',
  'package/lib/types/client/conversation-nodes/inbox.d.ts',
  'package/lib/types/client/conversation-nodes/message.d.ts',
  'package/lib/types/client/conversation-nodes/register.d.ts',
  'package/lib/types/client/conversation-nodes/retry.d.ts',
  'package/lib/types/client/conversation-nodes/tool.d.ts',
  'package/lib/types/client/conversation-nodes/turn-error.d.ts',
  'package/lib/types/client/conversation-nodes/turn-max-tokens.d.ts',
  'package/lib/types/client/conversation-nodes/turn-tail.d.ts',
  'package/lib/types/client/image-labels.d.ts',
  'package/lib/types/client/index.d.ts',
  'package/lib/types/client/input/blocks.d.ts',
  'package/lib/types/client/input/contract.d.ts',
  'package/lib/types/client/input/decorations.d.ts',
  'package/lib/types/client/input/facade.d.ts',
  'package/lib/types/client/input/hub.d.ts',
  'package/lib/types/client/input/machine.d.ts',
  'package/lib/types/client/input/submission-policy.d.ts',
  'package/lib/types/client/locales.d.ts',
  'package/lib/types/client/queue/QueueDock.d.ts',
  'package/lib/types/client/queue/store.d.ts',
  'package/lib/types/client/service.d.ts',
  'package/lib/types/client/settings/EnterBehaviorRow.d.ts',
  'package/lib/types/client/skeleton/ApprovalPanel.d.ts',
  'package/lib/types/client/skeleton/ContextMeter.d.ts',
  'package/lib/types/client/skeleton/ConversationRoot.d.ts',
  'package/lib/types/client/skeleton/ConversationSession.d.ts',
  'package/lib/types/client/skeleton/DetailsPanel.d.ts',
  'package/lib/types/client/skeleton/EmptyHero.d.ts',
  'package/lib/types/client/skeleton/InputBar.d.ts',
  'package/lib/types/client/skeleton/PermissionSelect.d.ts',
  'package/lib/types/client/skeleton/TodoPanel.d.ts',
  'package/lib/types/client/stores.d.ts',
  'package/lib/types/index.d.ts',
  'package/lib/types/invariant.d.ts',
  'package/lib/types/submission-settings.d.ts',
  'package/package.json',
] as const

/**
 * Fail when an actual tarball shrinks, expands, or renames the official inventory.
 * @param expected - authoritative package members.
 * @param actual - observed tarball members.
 */
export function assertExactPackageInventory(
  expected: readonly string[],
  actual: readonly string[],
): void {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const missing = [...expectedSet].filter(file => !actualSet.has(file)).sort()
  const extra = [...actualSet].filter(file => !expectedSet.has(file)).sort()
  const duplicates = actual.filter((file, index) => actual.indexOf(file) !== index)
  if (missing.length === 0 && extra.length === 0 && duplicates.length === 0) return
  const details = [
    ...missing.length === 0 ? [] : [`missing: ${missing.join(', ')}`],
    ...extra.length === 0 ? [] : [`extra: ${extra.join(', ')}`],
    ...duplicates.length === 0 ? [] : [`duplicates: ${[...new Set(duplicates)].sort().join(', ')}`],
  ]
  throw new Error(`ui-conversation packed inventory mismatch\n${details.join('\n')}`)
}

/** Pack the already-built package and return members observed from that tarball. */
export function packedUiConversationFiles(packageRoot = UI_CONVERSATION_ROOT): string[] {
  const pnpmEntrypoint = process.env.npm_execpath
  if (
    pnpmEntrypoint === undefined
    || pnpmEntrypoint === ''
    || !basename(pnpmEntrypoint).startsWith('pnpm')
  ) {
    throw new Error('ui-conversation inventory: invoke this verifier through a pnpm package script')
  }
  const destination = mkdtempSync(join(tmpdir(), 'dsh-ui-conversation-pack-'))
  try {
    // Windows cannot spawn the pnpm.cmd shim directly; use its JavaScript entrypoint shell-free.
    run(process.execPath, [pnpmEntrypoint, 'pack', '--pack-destination', destination], { cwd: packageRoot })
    const tarballs = readdirSync(destination).filter(file => file.endsWith('.tgz'))
    const tarball = tarballs[0]
    if (tarballs.length !== 1 || tarball === undefined) {
      throw new Error(`ui-conversation pack produced ${tarballs.length} tarballs`)
    }
    return tarballFiles(join(destination, tarball))
      .map(file => file.replace(/\r$/, '').replaceAll('\\', '/'))
  } finally {
    rmSync(destination, { recursive: true, force: true })
  }
}

/** Pack and verify the built ui-conversation package. */
export function verifyUiConversationPackageInventory(): void {
  assertExactPackageInventory(
    OFFICIAL_UI_CONVERSATION_PACKAGE_FILES,
    packedUiConversationFiles(),
  )
}

if (isEntry(import.meta.url)) verifyUiConversationPackageInventory()
