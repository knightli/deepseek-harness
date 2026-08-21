# Agent Note: Workspace fork rejection is visible

Status: implemented

English | [中文](2026-08-21-workspace-fork-rejection-is-visible.zh.md)

## Problem

The native Workspace Browser exposed a `Fork session` menu action for every listed Session. Its composition adapter started `sessions.fork`, opened the child on success, and swallowed every rejection. A deployment whose Agent reports `fork` as unavailable therefore rejected the request correctly at the Host boundary, but the original DSH UI gave the user no visible result.

## Decision

The Workspace Browser's injected `forkSession` action now returns `Promise<void>`. The adapter awaits the Host fork and opens the child only after success; it leaves rejection handling to the native browser surface that initiated the gesture. The adapter maps the runtime's structured `SessionForkError` to a UI-safe three-way outcome: proven admission refusal, known post-create failure, or unknown publication after transport uncertainty. The surface publishes distinct localized messages through the existing `Toast` primitive and never renders raw carrier or Host text; the unknown case tells the user to refresh the Session list before retrying. A per-show sequence remounts repeated messages, while a stable completion callback prevents unrelated browser rerenders from restarting the Toast lifetime.

The change remains capability-neutral. It does not inspect an Agent name, duplicate Session capabilities, hide the menu, replace the sidebar, or introduce a parallel interaction store. Host admission remains the authority, and the current Session selection remains unchanged when admission fails.

## Verification

The adapter test proves that success opens the returned child and that no-child, post-create, and transport-unknown failures propagate as stable action outcomes without a second open. Workspace Browser tests invoke the native row menu, observe the appropriate `role="alert"` copy for all three outcomes, prove raw errors are absent, confirm the current selection is not changed, and verify an unrelated rerender does not extend the four-second Toast lifetime. Focused `ui-workspace` component tests, the client library build, documentation gates, and the downstream assembled WebUI acceptance cover the package boundary.

## Alternatives considered

**Swallow the rejection and rely on the absence of a child row.** No visible feedback makes an intentional capability rejection indistinguishable from a broken click.

**Copy Session capabilities into workspace state and disable the menu.** That adds a second capability projection and a synchronization contract solely for this action. The Host already provides stable fail-closed admission; surfacing its rejection is the smaller generic seam.

**Render the raw error message.** Carrier details are not a stable user contract and may disclose implementation data. Localized fixed copy keeps the UI deterministic and safe.

## Consequences

`WorkspaceBrowserInjected.forkSession` becomes awaitable and outcome-aware. Existing successful forks keep their child-open behavior. Unsupported forks produce one native transient alert without a child; post-create setup failures produce distinct copy and preserve the listed child; transport uncertainty makes no publication claim and asks for a refresh before retry. None of these paths moves the current selection.
