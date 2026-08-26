# Agent Note: External Session authority

Status: implemented

English | [中文](2026-08-22-external-session-authority.zh.md)

## Problem

The Host previously treated every durable Session as locally authoritative. A deployment that projects conversations owned by another runtime could list imported history, but opening that row later had no public way to reconcile newly appended history or to route a rename back to the owning runtime. Adding deployment-specific logic inside the generic API gateway would couple the Host to one provider and risk creating a second execution history.

## Decision

`@deepseek-ai/dsh-host-apiproxy` exposes an optional `SessionAuthority` service. Its `refresh(sessionId)` runs before an externally owned cold or idle Session is served at the tail or resumed; `rename(sessionId, title)` mutates the external owner before the accepted title is projected into the local Session. Returning `undefined` from rename means the Session is not externally owned and preserves the ordinary local rename path.

The seam is exact-identity based. The provider decides whether a `SessionId` has an external binding; the Host neither guesses identity from title, cwd, timestamps, nor content, nor creates a parallel Session. An attached running Agent remains the active runtime authority and is not interrupted by refresh.

External titles use `SessionTitleService.projectExternal` and `clearExternal`. The durable `session/title-cleared` event lets an authority explicitly remove its projected title, including replacement of an older local fallback, while the same authority keeps the empty projection fenced from another authority, local rename, refresh, and automatic fallback. A missing external title therefore returns the generic projection to `null` instead of preserving stale display text.

Provider failures converge at the gateway boundary. Public history, prompt, and rename results carry stable Host errors and do not expose provider paths, protocol details, or credentials. Agent resolution maps an unavailable external writer to `thread-busy` with the addressed `sessionId`; the rejected request publishes no local work. Deployment providers own their per-Session serialization, resource lifetime, and teardown drain because the generic Host cannot know how their external runtime is shared.

## Alternatives considered

**Teach the Host about Codex thread IDs and app-server processes.** Rejected because the API gateway is provider-neutral; Codex identity, process ownership, and reconciliation belong in the deployment plugin.

**Refresh only at Host startup.** Rejected because another Host can advance the same external conversation after startup. Tail open and cold resume are the user-visible handoff boundaries that require a fresh snapshot.

**Mirror external renames only in the local title log.** Rejected because it would display a value the execution authority did not accept and would be overwritten on the next refresh.

**Treat a missing external title as a no-op.** Rejected because it retains stale local or external text after the authority has explicitly reported no title.

## Consequences

Deployments can project one externally owned conversation into stock DSH Session/history/title views and resume it by exact binding without duplicating execution state. Tail reads, writer acquisition, and accepted renames become asynchronous authority boundaries and can fail closed. Providers must serialize refresh and rename for one Session and drain those operations during unload. The Host tests pin public error convergence, the `thread-busy` wire branch, and exact external-title projection; deployment-level runnable Host tests must additionally prove the concrete provider keeps one runtime owner while refreshing.
