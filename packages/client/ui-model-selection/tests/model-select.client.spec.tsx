// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { conversationSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, SessionId, SnapshotStore, UseConversationSession,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useSyncExternalStore, type ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect, type ModelSelectProps } from '../src/client/ModelSelect.tsx'
import type { ModelSelectInjected } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const ordinarySnapshot = conversationSnapshot('s1' as SessionId)
const addressedSnapshot: ConversationSnapshot = {
  ...ordinarySnapshot,
  subagent: {
    address: {
      parentSessionId: 'parent' as SessionId,
      childSessionId: 's1' as SessionId,
      mode: 'continuable',
    },
    parentAvailable: true,
  },
}
const useOrdinarySession: UseConversationSession = selector => selector(ordinarySnapshot)
const useAddressedSession: UseConversationSession = selector => selector(addressedSnapshot)
const standardProps = {
  sessionId: 's1' as SessionId,
  useProjection: (() => undefined) as ModelSelectProps['useProjection'],
  useInput: (() => { throw new Error('unused') }) as ModelSelectProps['useInput'],
  inputActions: {
    setDraft: () => {},
    addImages: () => true,
    removeImage: () => {},
    pruneImages: () => {},
    submit: () => {},
  },
  useSessions: (() => { throw new Error('unused') }) as ModelSelectProps['useSessions'],
  useWorkspaces: (() => { throw new Error('unused') }) as ModelSelectProps['useWorkspaces'],
} satisfies Omit<PropsRuntime<'conversation.input.model'>, 'locked' | 'useSession'>

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    capabilities: undefined,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

function bindDirectory(
  directory: SnapshotStore<ModelDirectoryState>,
): ModelSelectProps['useDirectory'] {
  return selector => useSyncExternalStore(
    listener => directory.subscribe(listener),
    () => selector(directory.getSnapshot()),
  )
}

afterEach(cleanup)

describe('ModelSelect reasoning effort', () => {
  it('derives its complete component props from the standard shares', () => {
    type Expected = PropsRuntime<'conversation.input.model'>
      & InjectFace<ModelSelectInjected>
      & PropsLocale<'model'>
    expectTypeOf<ComponentProps<typeof ModelSelect>>().toEqualTypeOf<Expected>()
    expectTypeOf<ModelSelectProps>().toEqualTypeOf<Expected>()
  })

  it('renders adapter metadata and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return null
    })
    render(<ModelSelect
      {...standardProps}
      locked={false}
      useSession={useOrdinarySession}
      useDirectory={bindDirectory(directory)}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'MaxLargest budget'])

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Flash，推理等级 Max')
    })
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect
      {...standardProps}
      locked={false}
      useSession={useOrdinarySession}
      useDirectory={bindDirectory(directory)}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(null)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('prompts for a selection when the current model is no longer advertised', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(null)
    render(<ModelSelect
      {...standardProps}
      locked={false}
      useSession={useOrdinarySession}
      useDirectory={bindDirectory(directory)}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '选择模型' })
    expect(trigger.textContent).toContain('选择模型')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByText('removed-model')).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'model-unavailable: session already contains images' }))
      return 'model-unavailable: session already contains images'
    })
    render(<ModelSelect
      {...standardProps}
      locked={false}
      useSession={useOrdinarySession}
      useDirectory={bindDirectory(directory)}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    const directory = createSnapshotStore(state())
    render(<ModelSelect
      {...standardProps}
      locked={false}
      useSession={useAddressedSession}
      useDirectory={bindDirectory(directory)}
      load={load}
      select={vi.fn().mockResolvedValue(null)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('tracks ordinary and addressed transitions through the standing session hook', () => {
    const session = createSnapshotStore<ConversationSnapshot>(conversationSnapshot('s1' as SessionId))
    const useSession: UseConversationSession = selector => useSyncExternalStore(
      listener => session.subscribe(listener),
      () => selector(session.getSnapshot()),
    )
    const load = vi.fn()
    const directory = createSnapshotStore(state())
    render(<ModelSelect
      {...standardProps}
      locked={false}
      useSession={useSession}
      useDirectory={bindDirectory(directory)}
      load={load}
      select={vi.fn().mockResolvedValue(null)}
      t={t}
    />)
    expect(screen.getByRole('button')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)

    act(() => {
      session.update((draft) => {
        draft.subagent = {
          address: {
            parentSessionId: 'parent' as SessionId,
            childSessionId: 's1' as SessionId,
            mode: 'continuable',
          },
          parentAvailable: true,
        }
      })
    })
    expect(screen.queryByRole('button')).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)

    act(() => { session.update((draft) => { draft.subagent = null }) })
    expect(screen.getByRole('button')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
