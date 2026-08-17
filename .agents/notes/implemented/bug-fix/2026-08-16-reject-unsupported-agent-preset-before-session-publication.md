# Agent Note: Reject unsupported agent presets before Session publication

Status: implemented

English | [中文](2026-08-16-reject-unsupported-agent-preset-before-session-publication.zh.md)

## Problem

A deployment without an agent-preset roster uses the Host composition when `session.create` omits `agentPreset`. The same composition path also accepted an explicit preset id, published a new Agent and Session without recording that id, and only then rejected the request as an adoption conflict. The caller observed both a misleading error and a Session created by an unsupported request.

## Decision

`session.create` performs request-local admission before entering the Session-id creation single-flight. Without a roster, omission retains the shared Host composition; a fresh identity with an explicit id returns the existing `noRoster()` response and its stable `agent-preset-not-found` details before Agent creation. Live and persisted identities continue into the ordinary ownership, cwd, and immutable-composition checks.

The shared composition resolver keeps its no-roster behavior even when a recorded preset reaches it. This preserves cold resume and fork after a roster is removed, while naming a preset on a preset-less existing Session continues to return `agent-preset-conflict`. The fresh-publication boundary captures the exact roster beside its defensive no-roster check, before the project-directory suspension. Its setup calls `mountForPublication()` and returns the receipt to the Agent factory; the receipt synchronously revalidates the captured roster generation, standing scope/root fibers, and exact scope binding after every setup await and immediately before publication. An unload or same-fiber restart therefore rejects with the stable empty-roster response and rolls the unpublished Agent and Session back instead of publishing a Host-composed world.

The Session-id single-flight records the complete caller-local `{ cwd, presetId }` admission tuple with its Promise. A waiter that joined a different tuple retries its own ordered ownership, cwd, and immutable-composition admission after the owner settles, whether the owner failed or succeeded. One caller's roster, cwd, or persisted-preset result therefore cannot become another caller's classification.

## Verification

The API-proxy preset suite compares `session.list` before and after the refusal, observes the public Host stream to prove that no publish-and-rollback frames escaped, pins the complete typed error, verifies that composition is captured before directory creation, races named and omitted callers for one Session id, and covers failing and successful owners whose waiters disagree in both cwd and preset. A keyless real-Loader test mounts the Session registry, Agent registry, runtime fixture, and ApiProxyService, then drives the fetch/SSE carrier and proves zero factory calls, Sessions, and Host frames. The AgentPresets suite pauses a real Agent setup after obtaining its receipt, unloads or restarts the exact roster fiber, and proves commit rejection, registry rollback, and permanent revocation of the old receipt.

The shipped `dsh web` profile is booted first with only its optional roster disabled; its public HTTP result and unchanged Session list are pinned in `apps/web/tests/snapshots/no-roster-preset-admission/protocol.expected.json`. A second shipped-profile test mounts the real `standard` preset, pauses public HTTP `session.create` between Host pre-resolution and Agent setup, unloads that real roster entry, and proves the same stable error with no new Session identity. The neighboring adoption tests continue to pin the distinct behavior for an existing Session.

## Alternatives considered

**Raise a roster-unavailable exception from the shared composition resolver.** Fresh creation, cold resume, and fork all use that resolver, while concurrent callers share one creation Promise per Session id. A request-specific failure there both breaks recorded-history paths after roster removal and lets one caller's preset contaminate another caller's result.

**Create the Session and roll it back after detecting the missing roster.** Publication is observable through the Session registry and Host notifications. Rollback cannot make the unsupported request free of transient side effects.

**Extend the patch to child `composeFrom()` and both subagent drivers.** A child publication can cross the same generic roster-HMR boundary because the stock child path returns no preset receipt. That path predates this Host admission bug, is not reached by Task 3.6's public `session.create` RED, and needs its own caller-public gate plus a composite commit design. Folding it into this thin Host patch would silently broaden the authorized upstream change.

## Consequences

An unsupported explicit preset cannot add a Session row or Agent, and callers receive one stable roster error. A roster generation disappearing during admitted Host setup fails at the exact publication boundary with the same observable result. The default no-roster deployment behavior, existing-session identity checks, cold resume, and fork remain unchanged, while concurrent classification is local to the complete request tuple. Admission performs one persistence-list read only for an explicit-id, no-roster request whose identity is not already live.

The receipt guarantees Host creation-time publication safety, not lifetime continuity across roster HMR. Roster unload/restart still tears down standing compositions used by already-live agents, and the stock child `composeFrom()` publication path remains outside this patch. Both require a separate lifecycle design and gate before any stronger guarantee is documented.
