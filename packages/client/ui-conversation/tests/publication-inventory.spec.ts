import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = fileURLToPath(new URL('../src/', import.meta.url))

const OFFICIAL_DECLARATION_INVENTORY = [
  'lib/types/client/apply.d.ts',
  'lib/types/client/chat/AssistantMarkdown.d.ts',
  'lib/types/client/chat/AssistantNodeView.d.ts',
  'lib/types/client/chat/ChatNodeSeat.d.ts',
  'lib/types/client/chat/ChatView.d.ts',
  'lib/types/client/chat/CommandNodeView.d.ts',
  'lib/types/client/chat/CompactionCommandCard.d.ts',
  'lib/types/client/chat/CompactionItem.d.ts',
  'lib/types/client/chat/ContextBody.d.ts',
  'lib/types/client/chat/ContextInjectionRow.d.ts',
  'lib/types/client/chat/GenericCommandCard.d.ts',
  'lib/types/client/chat/MessageIconActions.d.ts',
  'lib/types/client/chat/MessageItem.d.ts',
  'lib/types/client/chat/ReasoningRow.d.ts',
  'lib/types/client/chat/StatsLine.d.ts',
  'lib/types/client/chat/TurnTailNodeView.d.ts',
  'lib/types/client/chat/message-chrome.d.ts',
  'lib/types/client/chat/register-node-renderers.d.ts',
  'lib/types/client/chat/tool-node-reader.d.ts',
  'lib/types/client/chat/turn-assistant.d.ts',
  'lib/types/client/chat/turn-metrics.d.ts',
  'lib/types/client/chat/use-calendar-day.d.ts',
  'lib/types/client/chat/use-throttled-visual-update.d.ts',
  'lib/types/client/contract/chat-nodes.d.ts',
  'lib/types/client/contract/composer-submission.d.ts',
  'lib/types/client/contract/queue.d.ts',
  'lib/types/client/contract/slots.d.ts',
  'lib/types/client/contract/views.d.ts',
  'lib/types/client/conversation-nodes/assistant.d.ts',
  'lib/types/client/conversation-nodes/chat-snapshot-builder.d.ts',
  'lib/types/client/conversation-nodes/command.d.ts',
  'lib/types/client/conversation-nodes/common.d.ts',
  'lib/types/client/conversation-nodes/compaction.d.ts',
  'lib/types/client/conversation-nodes/fallback.d.ts',
  'lib/types/client/conversation-nodes/inbox.d.ts',
  'lib/types/client/conversation-nodes/message.d.ts',
  'lib/types/client/conversation-nodes/register.d.ts',
  'lib/types/client/conversation-nodes/retry.d.ts',
  'lib/types/client/conversation-nodes/tool.d.ts',
  'lib/types/client/conversation-nodes/turn-error.d.ts',
  'lib/types/client/conversation-nodes/turn-max-tokens.d.ts',
  'lib/types/client/conversation-nodes/turn-tail.d.ts',
  'lib/types/client/image-labels.d.ts',
  'lib/types/client/index.d.ts',
  'lib/types/client/input/blocks.d.ts',
  'lib/types/client/input/contract.d.ts',
  'lib/types/client/input/decorations.d.ts',
  'lib/types/client/input/facade.d.ts',
  'lib/types/client/input/hub.d.ts',
  'lib/types/client/input/machine.d.ts',
  'lib/types/client/input/submission-policy.d.ts',
  'lib/types/client/locales.d.ts',
  'lib/types/client/queue/QueueDock.d.ts',
  'lib/types/client/queue/store.d.ts',
  'lib/types/client/service.d.ts',
  'lib/types/client/settings/EnterBehaviorRow.d.ts',
  'lib/types/client/skeleton/ApprovalPanel.d.ts',
  'lib/types/client/skeleton/ContextMeter.d.ts',
  'lib/types/client/skeleton/ConversationRoot.d.ts',
  'lib/types/client/skeleton/ConversationSession.d.ts',
  'lib/types/client/skeleton/DetailsPanel.d.ts',
  'lib/types/client/skeleton/EmptyHero.d.ts',
  'lib/types/client/skeleton/InputBar.d.ts',
  'lib/types/client/skeleton/PermissionSelect.d.ts',
  'lib/types/client/skeleton/TodoPanel.d.ts',
  'lib/types/client/stores.d.ts',
  'lib/types/index.d.ts',
  'lib/types/invariant.d.ts',
  'lib/types/submission-settings.d.ts',
] as const

function sourceDeclarations(directory: string, relative = ''): string[] {
  const declarations: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      declarations.push(...sourceDeclarations(`${directory}/${entry.name}`, path))
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      declarations.push(`lib/types/${path.replace(/\.(?:ts|tsx)$/, '.d.ts')}`)
    }
  }
  return declarations.sort()
}

describe('ui-conversation publication inventory', () => {
  it('emits exactly the official declaration paths', () => {
    expect(sourceDeclarations(SOURCE_ROOT)).toEqual(OFFICIAL_DECLARATION_INVENTORY)
  })
})
