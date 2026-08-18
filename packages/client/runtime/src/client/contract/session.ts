/**
 * The outward session face. Feature packages never see the concrete Session
 * class: components read conversation state through `useSession` (the
 * ObservableSnapshot half), and orchestration code calls the behavior verbs
 * below — nothing else. Widening this interface is the explicit act of
 * widening what features may do to a session (and what every test fixture
 * must stub); runtime-internal entry points (history staging, wire-frame
 * dispatch) stay on the class, invisible out here.
 */
import type { AttachmentIdType, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  MessageId, PromptContentPart, QueueAction, RpcResult, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ModelCatalogFailure, ModelProviderGroup, ModelSelection, SessionCapabilities, SessionModels,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ConversationSnapshot } from '../sessions/conversation.ts'
import type { ObservableSnapshot } from './store.ts'

/** Session-owned model directory projection shared by every stock model-selection entry. */
export interface SessionModelDirectorySnapshot {
  /** Host selection for the next assembled step; null until the first successful read. */
  readonly current: ModelSelection | null
  /** Whether the Host can route ordinary text for the current selection. */
  readonly routable: boolean | null
  /** Host-advertised operation admission for the current ready generation. */
  readonly capabilities: SessionCapabilities | undefined
  /** Last successfully loaded provider groups. */
  readonly groups: readonly ModelProviderGroup[]
  /** Provider-local catalog failures from the last successful read. */
  readonly failures: readonly ModelCatalogFailure[]
  /** Current directory or selection operation state. */
  readonly status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  /** Whole-request or selection failure text; provider-local failures stay in {@link failures}. */
  readonly error: string | null
}

/** Key-addressed projection read face (the useProjection resolution path; see ProjectionValueStore). */
export interface ProjectionsFace {
  /**
   * The identity-stable bare observable for one projection key (absence is
   * an `undefined` snapshot, never a missing face).
   * @param key - projection key.
   * @returns the key's value face.
   */
  faceOf(key: string): ObservableSnapshot<unknown>
}

/** Identity plus the behavior verbs features may invoke on a session. */
export interface ISession {
  /** The session's host identity (agent id — same axis). */
  readonly sessionId: SessionId
  /** Host-computed projection values by key (the useProjection seat). */
  readonly projections: ProjectionsFace
  /** One object-layer model authority; UI entries subscribe without copying its business state. */
  readonly modelDirectory: ObservableSnapshot<SessionModelDirectorySnapshot>
  /**
   * Read or join this ready generation's authoritative model directory.
   * @returns the cached or in-flight Host result for the ready generation.
   */
  loadModels(): Promise<RpcResult<SessionModels>>
  /**
   * Explicitly invalidate and refresh the model directory after an owner event.
   * @returns the replacement Host result after the previous authority is withdrawn.
   */
  refreshModels(): Promise<RpcResult<SessionModels>>
  /**
   * Select the complete provider/model/reasoning route for the next assembled step.
   * @param selection - complete provider, model, and optional reasoning effort.
   * @returns the Host-accepted selection, or a business/transport error.
   */
  selectModel(selection: ModelSelection): Promise<RpcResult<{ selected: ModelSelection }>>
  /**
   * Send a prompt into the session.
   * @param content - text plus browser-owned temporary image uploads.
   * @param mode - 'queue' appends a turn; 'steer' interrupts the running one.
   * @returns acceptance, or the business error (also mirrored into snapshot.promptError).
   */
  prompt(content: PromptContentPart[], mode: 'queue' | 'steer'): Promise<RpcResult<{ accepted: true }>>
  /**
   * Resolve one durable image referenced by this session.
   * @param attachmentId - opaque id found in the folded session log.
   * @returns the authenticated reference and decoded bytes.
   */
  readAttachment(
    attachmentId: AttachmentIdType,
  ): Promise<RpcResult<{ attachment: ImageAttachmentRef; data: Uint8Array }>>
  /**
   * Apply one edit, remove, or strict steer action to a still-pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns acceptance, or a business/transport error.
   */
  updateQueue(itemId: MessageId, action: QueueAction): Promise<RpcResult<{ accepted: true }>>
  /**
   * Cancel the running turn. Pending queued work remains and resumes in FIFO
   * order after the Host reaches cancellation quiescence.
   * @returns acceptance, or the business error.
   */
  cancel(): Promise<RpcResult<{ accepted: true }>>
  /**
   * Rename this session (explicit user title; pins it against automatic
   * regeneration).
   * @param title - raw title text (the host normalizes acceptance).
   * @returns the normalized accepted title and its event seq, or the business error.
   */
  rename(title: string): Promise<RpcResult<{ title: string; seq: number }>>
  /**
   * Extend the history window backwards (older messages pagination).
   * @returns completion; failures land in snapshot.openState/loadingOlder.
   */
  loadOlder(): Promise<void>
  /**
   * Execute one slash-command line against this session's agent — pure
   * admission semantics (the host executor durably logs the lifecycle).
   * @param line - the full command line, leading slash included.
   * @returns the admission result, or the Remote face's error branch.
   */
  command(line: string): Promise<RemoteResult<{ matched: boolean }>>
}

/**
 * The full outward face: behavior verbs plus the conversation read side
 * (the `useSession` hook source). This is the type carried by
 * `SessionBinding.session` and the provide channel.
 */
export type SessionFace = ISession & ObservableSnapshot<ConversationSnapshot>
