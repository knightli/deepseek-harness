// @vitest-environment jsdom
// Branch tails the acceptance specs do not reach: the node-half apply
// without a settings service and AssistantMarkdown reasoning/unknown block arms.

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { apply as nodeApply } from '../src/index.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locales.ts'

// Mirrors the real lookup chain (conversation namespace, then common).
const t: AssistantMarkdownProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

describe('tails', () => {
  it('node-half apply tolerates a Host without settings', () => {
    expect(() => { nodeApply(new Context()) }).not.toThrow()
  })

  it('AssistantMarkdown renders reasoning as a Think row and unknown blocks as JSON fallback', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'reasoning', text: 'thinking hard\nsecond line' },
          { kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' },
          { kind: 'other', block: { type: 'mystery' } },
        ]}
        streaming
      />,
    )
    expect(view.getByText('Think')).toBeTruthy()
    expect(view.getByText('thinking hard')).toBeTruthy()
    expect(view.getByText(/未知内容块/)).toBeTruthy()
    const stopped = render(
      <AssistantMarkdown t={t} blocks={[{ kind: 'text', text: 'partial words' }]} streaming={false} interrupted />,
    )
    expect(stopped.getByText('已停止')).toBeTruthy()
  })

  it('AssistantMarkdown offers a typed unknown block to the additive keyed seat', () => {
    const calls: Array<{ key: string; owner: unknown; entryKey: unknown }> = []
    const renderSlot = ((key: string, owner: unknown, options?: { entryKey?: unknown }) => {
      calls.push({ key, owner, entryKey: options?.entryKey })
      return <span>specialized block</span>
    }) as NonNullable<AssistantMarkdownProps['renderSlot']>
    const block = { type: 'synthetic.extra', value: 42 }
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'other', blockType: 'synthetic.extra', block }]}
        streaming
        renderSlot={renderSlot}
      />,
    )
    expect(view.getByText('specialized block')).toBeTruthy()
    expect(calls).toEqual([{
      key: 'conversation.chat.assistant-block',
      owner: { blockType: 'synthetic.extra', block, streaming: true },
      entryKey: 'synthetic.extra',
    }])
  })

  it('AssistantMarkdown skips the root shell when only tool-call heads remain', () => {
    // Tool heads are drawn by ChatView's tool groups; an empty root between
    // groups is layout noise (no text, no pulse, no interrupted marker).
    const empty = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'tool-call', callId: 'c', name: 'todo_write', argsRaw: '{}' }]}
        streaming={false}
      />,
    )
    expect(empty.container.firstChild).toBeNull()
    const blank = render(<AssistantMarkdown t={t} blocks={[]} streaming={false} />)
    expect(blank.container.firstChild).toBeNull()
  })

})
