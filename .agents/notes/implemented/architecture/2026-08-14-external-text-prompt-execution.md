# Agent Note: live Agent ownership of external text prompt execution

Status: implemented

English | [中文](2026-08-14-external-text-prompt-execution.zh.md)

## Problem

The Host exposes one session prompt protocol to every `AgentFactory` implementation. Testing only whether the DSH LLM registry serves the selected provider correctly protects the default agent loop, but it also rejects a custom Agent whose own driver consumes text from the public inbox and never dispatches through that registry.

Prompt execution authority belongs to one live Agent instance. Creation options describe the selected model route, session data reconstructs durable conversation facts, and Host configuration applies to a composition; none can state that one returned Agent owns external execution without over-admitting another Agent or persisting a runtime implementation fact.

## Decision

The public `Agent` interface carries the optional live capability `promptExecution?: { kind: 'external-text' }`. The Agent itself owns this declaration; it is not an `AgentOptions` field and does not belong to `AgentFactory` or `AgentRegistry` metadata.

When `promptExecution` is absent, `session.prompt` requires the selected provider to have a DSH LLM route and fails with `model-unavailable` before opening a turn when no adapter serves it. `external-text` admits ordinary text follow-up and steering without that route because the Agent's driver owns execution. It admits no other modality: image content fails before attachment validation or persistence with `attachment-error` and reason `MODEL_DOES_NOT_SUPPORT_IMAGES`.

`session.models.routable` means the Host admits ordinary text for the addressed live Agent. It is true when a DSH adapter serves the selected provider or the Agent declares `external-text`; it does not promise image admission and is independent of advisory catalog membership. The catalog remains available to external Agents for client compatibility, but `session.selectModel` fails with `model-unavailable` before adapter resolution and leaves both the current session selection and deployment default unchanged. The [default-model decision](../feature/2026-08-07-default-model-follows-the-picker.md) retains ownership of selection tiers, and the [Web model-selector decision](../feature/2026-07-24-web-session-model-selector.md) retains ownership of directory presentation.

The capability is neither durable nor inferred. A factory whose Agent depends on external text execution without a DSH route declares it on each Agent returned from both create and resume; an ordinary custom Agent may omit it. A restarted or resumed Agent that omits the declaration follows the default DSH-route check and is unroutable only when no adapter serves the selected provider. No session event, persistence schema, format version, factory API, or Host configuration changes.

## Verification

`packages/host/apiproxy/tests/api-proxy-models.spec.ts` pins both sides of the admission rule: an Agent without the capability remains unroutable and receives `model-unavailable` when its provider has no adapter, while an `external-text` Agent reports `routable: true`, delivers exact queued text to `followup` and steered text to `steer`, rejects an image before attachment work, and rejects model selection without changing either selection state or the deployment default. The subsystem `type-equiv` block copies the public property and JSDoc byte-for-byte from `packages/core/agent/src/runtime-types.ts`.

## Alternatives considered

**Put execution mode in `AgentOptions`.** Options describe the model route consumed by the default loop and cross creation boundaries as caller input. External execution is a property of the returned live implementation, and accepting it as caller configuration would let a caller claim capability that the Agent does not implement.

**Query `AgentFactory` or `AgentRegistry`.** A factory-wide answer cannot represent different live Agent implementations or capabilities after create and resume, while a registry query separates the fact from the object that owns prompt delivery.

**Add a Host-wide bypass.** Composition-wide configuration would admit every addressed Agent without proving which driver consumes the text, so one external integration could weaken default fail-closed behavior for unrelated sessions.

**Register a fake LLM adapter.** An adapter registration claims that DSH can resolve model metadata and dispatch requests. An external driver needs neither operation, and a fake route would blur image and model-selection semantics instead of rejecting them explicitly.

## Consequences

An out-of-tree Agent can use the native Host prompt protocol and Web composer for ordinary text without registering a false model adapter. The capability remains deliberately narrow: external Agents cannot accept image content or model selection through this protocol, and their visible model directory is compatibility data rather than a mutable execution route.

Factories that depend on external text execution without a DSH route must repeat the declaration on every create and resume path. Omission after restart is safe and makes session text unroutable only when no DSH adapter serves the selected provider; ordinary custom Agents can omit the declaration. Supporting another external modality or mutable external model selection requires a new discriminated capability and an explicit Host contract rather than broadening `external-text` implicitly.
