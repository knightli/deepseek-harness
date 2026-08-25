# Agent Note: Atomic ordered Session history insertion

Status: implemented

English | [中文](2026-08-22-atomic-session-history-insertion.zh.md)

## Problem

Some authoritative conversation providers can extend an older, already closed turn after a later turn has been projected. The Session physical log is intentionally append-only, so ordinary `Session.append()` can only put that newly discovered group at the physical tail. Rewriting or truncating durable records would weaken persistence recovery, observation, and audit guarantees, while a parallel transcript store would create a second history authority.

The existing public history path also used physical `seq` as both persistence position and presentation order. A late group therefore could not be shown before an already stored later turn without either breaking contiguous client pagination or teaching provider-specific behavior to Session, persistence, Host, and UI packages.

## Decision

`@deepseek-ai/dsh-session` owns a provider-neutral atomic history capsule. `Session.insertHistoryGroup()` accepts a stable receipt, a stable logical anchor, and one or more complete closed turns or complete closed steps. A turn capsule requires a `turn/start` anchor; a step capsule requires a `step/start` anchor. It appends exactly one required `session/history-insert` physical record. Ordinary `Session.append()` excludes and runtime-rejects that control type, so callers cannot publish partially assembled capsules.

Ordered insertion is deliberately limited to unpublished preparation. A caller prepares or restores a detached Session, performs all insertions, then publishes it with `ctx.sessions.enter()` and `ctx.sessions.announce()`. Once attached to a live store, `insertHistoryGroup()` fails with `LIVE_SESSION_UNSUPPORTED`. This prevents an already-open client from observing old logical sequence numbers shift underneath it.

The canonical `Session.history` fold expands capsules into immutable `entries` and contiguous logical `events`. Ordinary physical events have stable logical identities derived from their physical seq; inserted members derive identity from receipt and member index. The logical event view renumbers execution turn and step fields in presentation order while leaving the physical log and capsule bytes unchanged. `materializeSessionHistory()` provides the same fold for detached persistence reads.

Receipts are exact-idempotency keys. Reapplying the same command is a no-op; reusing a receipt for different bytes fails closed. Missing anchors, mismatched turn/step anchors, incomplete or mixed groups, malformed nested messages, duplicate receipts, and corrupt source references reject before a Session is published or mutated. A capsule is one JSONL record or one SQLite row, so the existing backend record-atomicity and torn-tail contracts apply without a backend-specific transaction protocol.

The Host history carrier paginates canonical logical events. Live ordinary physical appends are translated to their current logical seq before delivery, and projection watermarks are translated at the same wire boundary. A capsule itself has no transcript event and is not emitted as one. Pagination treats all members from one insertion receipt as an indivisible group: if a requested boundary or page quota lands inside that group, the page expands or snaps to the receipt boundary instead of exposing a partial insertion. This keeps the client conversation assembler on its existing contiguous numeric-seq contract while persistence and projection services retain physical seq internally.

Fork requests continue to name a logical history boundary. The Host maps the desired completed-turn prefix back to physical source records and verifies that rematerializing that physical prefix is exactly equal to the requested logical prefix. A prefix that would require splitting a capsule has no faithful physical seed and therefore returns `fork-unavailable`; a full prefix that includes the capsule remains forkable. The Host never guesses a nearby cut.

The pre-release session format remains version `0`. An older runtime does not silently misread a capsule: the event is required, absent from its generated known-event catalog, and rejected at persistence load. The repository's pre-release policy provides no compatibility migration; the generated catalog records the new required vocabulary.

## Alternatives considered

**Rewrite the physical log into chronological order.** Rejected because it changes durable history already observed by persistence and projection consumers and makes crash recovery depend on a multi-record rewrite transaction.

**Append each inserted member as an ordinary event.** Rejected because a crash or observer failure can expose a partial closed group, and physical tail order still disagrees with presentation order.

**Store a provider-specific side transcript.** Rejected because it creates a second execution/history authority and bypasses stock Session, persistence, Host, and client behavior.

**Add a general history-edit DSL.** Rejected for this seam because move/delete/replace operations are not required. A single anchored whole-group insertion is smaller and validates either complete turns or complete steps as one domain operation.

**Use fractional or gapped numeric seq values.** Rejected because client paging, surface references, projections, and persistence all rely on contiguous safe-integer seqs. Stable logical identities plus a materialized contiguous view preserve those contracts.

## Consequences

- Physical Session storage stays append-only and backend-neutral; one logical group is one physical commit.
- Transcript consumers that need chronological history use `Session.history` or `materializeSessionHistory()`. Raw `Session.events` remains the physical persistence/audit log.
- Host history and live frames remain contiguous to existing clients even after an insertion, while internal projection watermarks keep their physical source of truth. Pages never split one receipt group.
- Forking keeps logical boundary semantics but succeeds only when an exact physical prefix rematerializes to that logical prefix; boundaries inside an inserted group fail closed.
- Insertions are intentionally limited to complete closed turns or steps at a matching stable later start anchor. Insertion inside an open step, deletion, arbitrary reordering, and concurrent multi-writer merging remain unsupported and fail closed.
- The new required event type is deliberately visible to compatibility gates; older pre-release readers reject rather than skip it.
