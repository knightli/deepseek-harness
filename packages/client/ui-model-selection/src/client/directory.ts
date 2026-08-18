/**
 * Thin presentation facade over the runtime Session's one model authority.
 * The /model popup and composer seat subscribe to the exact same object-layer
 * observable and delegate every operation to that Session; this package owns
 * no groups/current/routable mirror and issues no wire RPC itself.
 */
import type { ModelSelection, SessionModels } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ObservableSnapshot, SessionFace, SessionModelDirectorySnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Directory snapshot both entries render from (runtime authority, not a UI-owned copy). */
export type ModelDirectoryState = SessionModelDirectorySnapshot

/** One session's shared presentation controller; disposed with the session scope. */
export class ModelDirectory {
  /** Identity-stable runtime observable shared by both entries. */
  readonly store: ObservableSnapshot<ModelDirectoryState>

  /**
   * @param session - the owning runtime Session face.
   * @param available - whether this session may use Agent-bound model operations.
   */
  constructor(
    private readonly session: SessionFace,
    private readonly available: () => boolean,
  ) {
    this.store = session.modelDirectory
  }

  /**
   * Read or join the ready generation's advisory directory.
   * @returns The Host-owned model directory for the current generation.
   */
  async load(): Promise<SessionModels> {
    this.assertAvailable()
    const result = this.store.getSnapshot().status === 'error'
      ? await this.session.refreshModels()
      : await this.session.loadModels()
    if (!result.ok) throw new Error(`session.models failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }

  /**
   * Refresh after a Host owner invalidation rather than reusing the generation cache.
   * @returns The newly read Host-owned model directory.
   */
  async refresh(): Promise<SessionModels> {
    this.assertAvailable()
    const result = await this.session.refreshModels()
    if (!result.ok) throw new Error(`session.models failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }

  /**
   * Submit through the Session that owns the model projection.
   * @param selection - the provider, model, and optional reasoning effort to select.
   */
  async select(selection: ModelSelection): Promise<void> {
    this.assertAvailable()
    const result = await this.session.selectModel(selection)
    if (!result.ok) throw new Error(`session.selectModel failed: ${result.error.code}: ${result.error.message}`)
  }

  /** Scope teardown needs no state cleanup; the runtime Session owns the source. */
  dispose(): void {}

  private assertAvailable(): void {
    if (!this.available()) {
      throw new Error('model selection is unavailable for addressed subagent sessions')
    }
  }
}
