/** Shared stable values for the assembled external-text Agent fixture. */

/** Provider intentionally absent from the assembled Web model registry. */
export const EXTERNAL_PROVIDER = 'external-runtime'
/** Model owned by the deterministic external Agent fixture. */
export const EXTERNAL_MODEL = 'external-model'
/** Assistant marker emitted by a freshly created Agent after queued input. */
export const CREATE_QUEUE_REPLY = 'EXTERNAL_CREATE_QUEUE_OK'
/** Assistant marker emitted by a freshly created Agent after steering input. */
export const CREATE_STEER_REPLY = 'EXTERNAL_CREATE_STEER_OK'
/** Assistant marker emitted after a process-cold Agent resume. */
export const RESUME_QUEUE_REPLY = 'EXTERNAL_RESUME_QUEUE_OK'

/** One observable fixture lifecycle or delivery action. */
export type ExternalTextAgentTrace =
  | { kind: 'create'; sessionId: string }
  | { kind: 'resume'; sessionId: string }
  | {
    kind: 'deliver'
    source: 'startup' | 'resume' | 'clear' | 'compact'
    target: 'next-turn' | 'next-step'
    text: string
  }
  | {
    kind: 'cancel'
    source: 'startup' | 'resume' | 'clear' | 'compact'
    cause: 'user' | 'parent' | 'hook' | 'disposed'
  }
