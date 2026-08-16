# Agent Note: Reject unsupported agent presets before Session publication

Status: implemented

English | [中文](2026-08-16-reject-unsupported-agent-preset-before-session-publication.zh.md)

## Problem

A deployment without an agent-preset roster uses the Host composition when `session.create` omits `agentPreset`. The same composition path also accepted an explicit preset id, published a new Agent and Session without recording that id, and only then rejected the request as an adoption conflict. The caller observed both a misleading error and a Session created by an unsupported request.

## Decision

`session.create` performs request-local admission before entering the Session-id creation single-flight. Without a roster, omission retains the shared Host composition; a fresh identity with an explicit id returns the existing `noRoster()` response and its stable `agent-preset-not-found` details before Agent creation. Live and persisted identities continue into the ordinary ownership, cwd, and immutable-composition checks.

The shared composition resolver keeps its no-roster behavior even when a recorded preset reaches it. This preserves cold resume and fork after a roster is removed, while naming a preset on a preset-less existing Session continues to return `agent-preset-conflict`. The fresh-publication boundary repeats the no-roster check in case an existing identity disappears after admission; an omitted-preset waiter that joined that request-specific failure retries after the single-flight clears, so it can create the identity without inheriting another caller's unsupported preset.

## Verification

The API-proxy preset suite compares `session.list` before and after the refusal, observes the public Host stream to prove that no publish-and-rollback frames escaped, pins the complete typed error, races a named request against an omitted-preset request for one Session id, and repeats that race while the admitted identity disappears before creation. A keyless real-Loader test mounts the Session registry, Agent registry, runtime fixture, and ApiProxyService, then drives the fetch/SSE carrier and proves zero factory calls, Sessions, and Host frames. The neighboring adoption tests continue to pin the distinct behavior for an existing Session.

## Alternatives considered

**Raise a roster-unavailable exception from the shared composition resolver.** Fresh creation, cold resume, and fork all use that resolver, while concurrent callers share one creation Promise per Session id. A request-specific failure there both breaks recorded-history paths after roster removal and lets one caller's preset contaminate another caller's result.

**Create the Session and roll it back after detecting the missing roster.** Publication is observable through the Session registry and Host notifications. Rollback cannot make the unsupported request free of transient side effects.

## Consequences

An unsupported explicit preset cannot add a Session row or Agent, and callers receive one stable roster error. The default no-roster deployment behavior, existing-session identity checks, cold resume, fork, and caller-neutral Session-id single-flight remain unchanged. Admission performs one persistence-list read only for an explicit-id, no-roster request whose identity is not already live.
