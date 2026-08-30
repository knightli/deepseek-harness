# 会话标题

[English](session-title.md) | 中文

[`@deepseek-ai/dsh-session-title`](../../packages/session/session-title) 所拥有的持久、后写覆盖的标题状态与可选异步提供方词汇。共享 LLM（大语言模型）辅助组件负责精确的辅助请求记录。各包 README 负责时序、回退、失败与 fork 行为；生成的[持久化日志事件目录](../persistence-catalog.md)负责完整的事件声明。

源码：[`packages/session/session-title/src/index.ts`](../../packages/session/session-title/src/index.ts)、[`packages/session/session-title-llm/src/index.ts`](../../packages/session/session-title-llm/src/index.ts)、[`packages/host/apiproxy/src/index.ts`](../../packages/host/apiproxy/src/index.ts)

## 持久标题状态

提供方生成修订时会记录 `SessionTitleProviderId`。`SessionTitleEventData` 列出生成标题时使用的精确人类消息 seq，`SessionTitleSnapshot` 则加入 `foldSessionTitle()` 选出的持久事件封装信息。

```ts type-equiv
/** Identifies one session-title provider registration. */
type SessionTitleProviderId = Branded<'SessionTitleProviderId'>
```

```ts type-equiv
/** Identifies an external system that remains authoritative for a projected title. */
type SessionTitleAuthorityId = Branded<'SessionTitleAuthorityId'>
```

```ts type-equiv
/** Accepted external rename projected only after the authority mutation succeeds. */
interface SessionAuthorityRename {
  readonly title: string
  readonly authority: SessionTitleAuthorityId
  /** Logical title-event seq when the authority projected a cold Session itself. */
  readonly seq?: number
}
```

外部 Session 权威可以把单向列表提示与模型和能力发现所使用的只读运行时事实分开发布。

```ts type-equiv
/** One-way list hint for a conversation whose transcript remains externally owned. */
interface SessionAuthorityListMetadata {
  /** The authority has confirmed this is a conversation, even before local history is projected. */
  readonly nonBlank: true
}
```

```ts type-equiv
/** Read-only facts an external authority can expose without acquiring a live Agent. */
interface SessionAuthorityDescription {
  /** Known writer model; absent while discovery has not acquired a writer yet. */
  readonly current?: ModelSelection
  /** Whether ordinary text may acquire the writer and execute externally. */
  readonly routable: boolean
  /** Operations admitted before resolving a live Agent. */
  readonly capabilities: SessionCapabilities
}
```

```ts type-equiv
/** Exact auxiliary model route that produced a title. */
interface SessionTitleModelProvenance {
  /** Registered LLM provider route. */
  readonly provider: string
  /** Provider model id. */
  readonly model: string
}
```

```ts type-equiv
/** Durable ownership record for an accepted session title. */
type SessionTitleSource =
  | { readonly kind: 'fallback' }
  | {
    readonly kind: 'provider'
    readonly provider: SessionTitleProviderId
    readonly model?: SessionTitleModelProvenance
  }
  | {
    /** Explicit user rename: pins the title — automatic generation stops scheduling. */
    readonly kind: 'user'
  }
  | {
    /** A title projected from an external system that remains its mutation authority. */
    readonly kind: 'external'
    readonly authority: SessionTitleAuthorityId
  }
```

```ts type-equiv
/** Payload of the log-only `session/title` event. */
interface SessionTitleEventData {
  /** Normalized non-empty title text. */
  readonly title: string
  /** Exact human `user/message` seqs used to derive this title; empty for explicit user or external titles. */
  readonly messageSeqs: number[]
  /** Whether fallback, a provider, the user, or an external authority supplied the title. */
  readonly source: SessionTitleSource
}
```

```ts type-equiv
/** Latest folded title plus the title event's durable envelope facts. */
interface SessionTitleSnapshot extends SessionTitleEventData {
  /** Seq of the latest `session/title` event. */
  readonly eventSeq: number
  /** Timestamp of the latest `session/title` event. */
  readonly updatedAt: number
}
```

## 辅助请求记录

共享 LLM 辅助组件会在调用模型前，记录每一项已经过验证且可分发的标题请求。即使后续生成失败，载荷仍会复现模型可见的系统输入与消息输入、路由、输出上限、提供方归属和源消息归因。

```ts type-equiv
/** Exact model-visible request recorded before one auxiliary title dispatch. */
interface SessionTitleLlmRequestEventData {
  /** Registered title-provider identity responsible for the request. */
  readonly titleProvider: SessionTitleProviderId
  /** Exact human `user/message` seqs represented in `messages`. */
  readonly messageSeqs: number[]
  /** Exact auxiliary LLM route. */
  readonly route: SessionTitleModelProvenance
  /** Exact auxiliary system prompt. */
  readonly system: string
  /** Exact auxiliary message list. */
  readonly messages: Message[]
  /** Exact auxiliary output-token cap. */
  readonly maxTokens: number
}
```

## 提供方输入与输出

服务会对截至某一修订的合格消息创建快照。提供方返回的 seq 仅可来自该请求；由服务负责的接纳流程会验证顺序、规范化标题、强制执行字节上限，并追加标题及其来源消息 seq 和来源类型。

```ts type-equiv
/** One eligible human text message exposed to title providers. */
interface SessionTitleUserMessage {
  /** Source `user/message` event seq. */
  readonly seq: number
  /** Exact concatenated text-block content. */
  readonly text: string
}
```

```ts type-equiv
/** Automatic generation cadence owned by a registered provider. */
type SessionTitleAutomaticMode = 'first-prompt' | 'all-prompts'
```

```ts type-equiv
/** Immutable input supplied to one title-provider call. */
interface SessionTitleProviderRequest {
  /** Live session being titled. */
  readonly session: Session
  /** All eligible human messages through this generation revision. */
  readonly messages: readonly SessionTitleUserMessage[]
  /** Exact current logged main-request route, when one has been recorded. */
  readonly route?: SessionTitleModelProvenance
  /** Cancellation for supersession, disposal, timeout composition, or the explicit caller. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Provider output before service-owned normalization and log acceptance. */
interface SessionTitleProviderResult {
  /** Proposed title text. */
  readonly title: string
  /** Exact seqs from `request.messages` used by this result. */
  readonly messageSeqs: readonly number[]
  /** Auxiliary LLM route, when generation used a model. */
  readonly model?: SessionTitleModelProvenance
}
```

```ts type-equiv
/** One optional asynchronous title implementation registered with the service. */
interface SessionTitleProvider {
  /** Stable id of the provider recorded with the title. */
  readonly id: SessionTitleProviderId
  /** When new human prompts start automatic generation. */
  readonly automatic: SessionTitleAutomaticMode
  /**
   * Produce one title revision.
   * @param request - message snapshot, current route, session, and cancellation.
   * @returns proposed title plus exact input seqs and the optional provider/model route used to generate it.
   */
  generate(request: SessionTitleProviderRequest): Promise<SessionTitleProviderResult>
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionauthority--sessionauthority"></a>

### `ctx.sessionAuthority` — `SessionAuthority`

Optional per-Session authority bridge; unowned identities are no-ops.

```ts cordis-catalog
/** Refresh externally-owned Session rows before the stock session.list snapshot. */
refreshCatalog?(): Promise<void>

/**
 * Read the last successfully refreshed catalog hint without I/O.
 * The hint is deliberately one-way: an authority may make a conversation
 * visible, but may not hide a locally non-blank Session.
 * @param sessionId - exact DSH Session identity whose catalog metadata is requested.
 * @returns the current visibility hint, or `undefined` for an unowned Session.
 */
listMetadata?(sessionId: SessionId): SessionAuthorityListMetadata | undefined

/**
 * Describe an externally-owned Session without refreshing or acquiring it.
 * @param sessionId - exact DSH Session identity whose runtime facts are requested.
 * @returns authoritative read-only facts, or `undefined` for an unowned Session.
 */
describe?(sessionId: SessionId): Promise<SessionAuthorityDescription | undefined>

/**
 * Return a complete advisory directory for an externally-owned Session.
 * @param sessionId - exact externally-owned Session identity.
 * @returns The directory, or undefined when this authority does not own the Session.
 */
models?(sessionId: SessionId): Promise<SessionModels | undefined>

/**
 * Acquire the external writer after explicit user intent.
 * @param sessionId - exact externally-owned Session identity.
 * @returns Acquisition outcome, or undefined when this authority does not own the Session.
 */
activate?(sessionId: SessionId): Promise<SessionAuthorityActivation | undefined>

/**
 * Mutate the next-turn selection for an externally-owned Session.
 * @param sessionId - exact externally-owned Session identity.
 * @param selection - complete provider, model, and optional reasoning route.
 * @returns Accepted selection, or undefined when this authority does not own the Session.
 */
selectModel?( sessionId: SessionId, selection: ModelSelection, ): Promise<ModelSelection | undefined>

/**
 * Reconcile an externally-owned Session before a cold or idle access.
 * @param sessionId - exact DSH Session identity whose binding is authoritative.
 * @returns when the same Session has been refreshed or is not externally owned.
 */
refresh(sessionId: SessionId): Promise<void>

/**
 * Mutate the external authority before projecting an accepted rename locally.
 * @param sessionId - exact DSH Session identity whose binding is authoritative.
 * @param title - already normalized non-empty title requested by the caller.
 * @returns accepted external projection, or `undefined` for an unowned Session.
 */
rename?(sessionId: SessionId, title: string): Promise<SessionAuthorityRename | undefined>
```

Types: [ModelSelection](core.md) · [SessionId](core.md)

Source: [`packages/host/apiproxy/src/index.ts:76`](../../packages/host/apiproxy/src/index.ts)

<a id="ctxsessiontitle--sessiontitleservice"></a>

### `ctx.sessionTitle` — `SessionTitleService`

Log-backed title fold plus asynchronous fallback generation.

```ts cordis-catalog
/**
 * Read the latest folded title from one live or replayed session.
 * @param session - session whose log is the title source of truth.
 * @returns latest title snapshot, or `undefined` before eligible input.
 */
get(session: Session): SessionTitleSnapshot | undefined

/**
 * Normalize and validate one explicit title without mutating a Session.
 * @param title - raw explicit title.
 * @returns normalized non-empty title.
 */
normalize(title: string): string

/**
 * Project the current title owned by an external authority. Detached replay
 * Sessions are accepted so a caller can persist the appended event before
 * exposing or resuming the Session. An exact current projection is a no-op.
 * @param session - live or replayed Session receiving the projection.
 * @param title - raw non-empty title reported by the authority.
 * @param authority - stable owner of the projected title.
 * @returns latest externally-owned title snapshot.
 */
projectExternal( session: Session, title: string, authority: SessionTitleAuthorityId, ): SessionTitleSnapshot

/**
 * Clear the current title when an external authority reports no title.
 * This deliberately supersedes legacy local sources; a title owned by a
 * different external authority remains fenced.
 * @param session - live or replayed Session receiving the clearing event.
 * @param authority - stable owner of the title being removed.
 */
clearExternal(session: Session, authority: SessionTitleAuthorityId): void

/**
 * Accept an explicit user title. Appends a `session/title` event with the
 * `user` source, which pins the title: in-flight automatic generation is
 * superseded and later user messages schedule none (an explicit
 * {@link SessionTitleService.refresh} remains the deliberate unpin).
 * @param session - exact live session to rename.
 * @param title - raw user input; normalized before acceptance.
 * @returns the accepted title snapshot.
 * @throws {SessionTitleInvalidError} when the title normalizes to empty.
 * @throws {Error} when the session is not live or the service is disposed.
 */
rename(session: Session, title: string): SessionTitleSnapshot

/**
 * Explicitly retry the registered provider, or materialize the built-in
 * fallback when no provider is registered.
 * @param session - exact live session to refresh.
 * @param signal - optional caller cancellation.
 * @returns latest accepted title, or `undefined` when no eligible text exists.
 */
async refresh(session: Session, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>

/**
 * Register the sole optional title provider. Disposal aborts its pending and
 * active work before another provider may register.
 * @param provider - provider identity, cadence, and generation function.
 * @returns exact Cordis effect disposer, which settles after active calls quiesce.
 */
register(provider: SessionTitleProvider): () => Promise<void>
```

Types: [Session](session.md)

Source: [`packages/session/session-title/src/index.ts:297`](../../packages/session/session-title/src/index.ts)
<!-- END GENERATED cordis-surface -->
