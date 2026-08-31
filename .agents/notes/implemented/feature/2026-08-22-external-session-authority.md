# Agent Note: External Session authority

Status: implemented

English | [中文](2026-08-22-external-session-authority.zh.md)

## Problem

The Host previously treated every durable Session as locally authoritative. A deployment that projects conversations owned by another runtime could list imported history, but opening that row later had no public way to reconcile newly appended history or to route a rename back to the owning runtime. Adding deployment-specific logic inside the generic API gateway would couple the Host to one provider and risk creating a second execution history.

## Decision

`@deepseek-ai/dsh-host-apiproxy` exposes an optional `SessionAuthority` service. Its `refresh(sessionId)` runs before an externally owned cold or idle Session is served at the tail or resumed; `rename(sessionId, title)` mutates the external owner before the accepted title is projected into the local Session. Returning `undefined` from rename means the Session is not externally owned and preserves the ordinary local rename path. Optional `models(sessionId)` and `selectModel(sessionId, selection)` operations similarly keep model-directory reads and selection writes with that owner. A directory may expose `current: null` before writer acquisition when its catalog is known but its exact next-step selection is not. Merely opening or reading that Session remains passive. The explicit `session.activate` operation is the write-intent boundary: `SessionAuthority.activate(sessionId)` may acquire the writer and return its complete model authority, or return `busy` so the API publishes the stable `thread-busy` refusal. Model selection follows only after activation; it is not an implicit writer-acquisition path.

Catalog refresh and transcript refresh remain separate. `refreshCatalog()` may establish header-only Session rows, and `listMetadata(sessionId)` synchronously exposes read-only hints from the last successful refresh so those externally confirmed conversations remain visible before their transcript is projected. `nonBlank: true` cannot mark a locally non-blank Session as blank. Optional `displayTitleFallback` supplies a provider-owned label only when the client has no durable title; it travels on `SessionSummary` but never enters title projection, history, persistence, or rename. The stock client resolves display text in the order durable title, external display fallback, cwd basename, then Session id. The Host performs no external I/O while summarizing rows.

The seam is exact-identity based. The provider decides whether a `SessionId` has an external binding; the Host neither guesses identity from title, cwd, timestamps, nor content, nor creates a parallel Session. An attached running Agent remains the active runtime authority and is not interrupted by refresh.

External titles use `SessionTitleService.projectExternal` and `clearExternal`. The durable `session/title-cleared` event lets an authority explicitly remove its projected title, including replacement of an older local fallback, while the same authority keeps the empty projection fenced from another authority, local rename, refresh, and automatic fallback. A missing external title therefore returns the generic projection to `null` instead of preserving stale display text.

Provider failures converge at the gateway boundary. Public history, prompt, and rename results carry stable Host errors and do not expose provider paths, protocol details, or credentials. Agent resolution maps an unavailable external writer to `thread-busy` with the addressed `sessionId`; the rejected request publishes no local work. Deployment providers own their per-Session serialization, resource lifetime, and teardown drain because the generic Host cannot know how their external runtime is shared.

## Alternatives considered

**Teach the Host about Codex thread IDs and app-server processes.** Rejected because the API gateway is provider-neutral; Codex identity, process ownership, and reconciliation belong in the deployment plugin.

**Refresh only at Host startup.** Rejected because another Host can advance the same external conversation after startup. Tail open and cold resume are the user-visible handoff boundaries that require a fresh snapshot.

**Load every external transcript during catalog refresh.** Rejected because sidebar discovery must remain metadata-only; eagerly projecting every history would make one slow or malformed conversation delay the whole list.

**Mirror external renames only in the local title log.** Rejected because it would display a value the execution authority did not accept and would be overwritten on the next refresh.

**Treat a missing external title as a no-op.** Rejected because it retains stale local or external text after the authority has explicitly reported no title.

**Persist the catalog preview as a Session title.** Rejected because a provider's read-only catalog label is not writable title authority. Persistence would create a competing source, make rename semantics misleading, and preserve stale preview text after the external catalog changes.

## Consequences

Deployments can project one externally owned conversation into stock DSH Session/history/title views and resume it by exact binding without duplicating execution state. A successful catalog refresh can expose and label the row immediately while its complete history remains lazy; a later durable title automatically wins without mutating or erasing the catalog hint. Tail reads, writer acquisition, and accepted renames become asynchronous authority boundaries and can fail closed. Providers must serialize refresh and rename for one Session and drain those operations during unload. The Host tests pin catalog visibility, list-label precedence, public error convergence, the `thread-busy` wire branch, and exact external-title projection; deployment-level runnable Host tests must additionally prove the concrete provider keeps one runtime owner while refreshing.
