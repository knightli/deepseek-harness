# Agent Note: Reject unsupported agent presets before Session publication

Status: implemented

English | [中文](2026-08-16-reject-unsupported-agent-preset-before-session-publication.zh.md)

## Problem

A deployment without an agent-preset roster uses the Host composition when `session.create` omits `agentPreset`. The same composition path also accepted an explicit preset id, published a new Agent and Session without recording that id, and only then rejected the request as an adoption conflict. The caller observed both a misleading error and a Session created by an unsupported request.

## Decision

The Host composition resolver distinguishes an omitted preset from an explicit id. Without a roster, omission retains the shared Host composition, while an explicit id raises a roster-unavailable failure before Agent creation. `session.create` maps that failure through the existing `noRoster()` response to stable `agent-preset-not-found` details.

Existing Session adoption remains separate. Its recorded composition is checked before a resolver is needed, so naming a preset on a preset-less existing Session continues to return `agent-preset-conflict` rather than changing that Session's identity.

## Verification

The API-proxy preset suite creates through the public Host API, compares `session.list` before and after the refusal, and pins the complete typed error. The neighboring adoption tests continue to pin the distinct conflict behavior for an existing Session.

## Alternatives considered

**Reject every explicit preset at the `session.create` handler when no roster exists.** That check cannot distinguish a fresh creation from adopting an existing preset-less Session without duplicating the resolver's identity work, and it would replace the established conflict response for the latter.

**Create the Session and roll it back after detecting the missing roster.** Publication is observable through the Session registry and Host notifications. Rollback cannot make the unsupported request free of transient side effects.

## Consequences

An unsupported explicit preset cannot add a Session row or Agent, and callers receive one stable roster error. The default no-roster deployment behavior and existing-session identity checks remain unchanged. The resolver gains one internal failure type so the RPC handler can preserve the existing wire error vocabulary.
