# Agent Note: Fail-closed session capability admission

Status: implemented

English | [中文](2026-08-17-fail-closed-session-capability-admission.zh.md)

## Problem

An Agent implementation may own text execution while lacking DSH image, model-selection, or seeded-fork behavior. The Host enforced some of those differences, but the native Web conversation initially exposed image intake and branch actions before its capability read settled. A session switch could also render one frame from the previous session's loaded snapshot. Separately, an unknown slash command addressed to a cold persisted session resumed and published its Agent before the Host learned that no handler existed.

These optimistic paths made unavailable controls actionable and let a definite command miss mutate process state before returning an error.

## Decision

`AgentFactory.sessionCapabilities` is an optional factory-wide declaration. Omission preserves stock behavior, including seeded forks; `forkFromSeed: false` denies generic fork admission. The registry reads the declaration from the factory that owns a live Agent or the active factory that would resume a cold session without performing that resume. The Host returns `imageInput`, `modelSelection`, and `fork` in `session.models.capabilities` and enforces the same facts in the corresponding write paths.

The runtime Session owns one `SessionModels` authority exposed as the read-only `modelDirectory` observable. `ConversationSnapshot.sessionCapabilities` derives from that same value, and the stock model-selection plugin delegates load, owner-event refresh, and selection to the Session instead of keeping a second groups/current/routable projection or issuing its own RPC. Every consumer therefore joins or reuses one settled read for the ready generation. Disconnect, generation start, explicit refresh invalidation, and a switch to addressed subagent transport synchronously retract the authority, invalidate reads and selections, and fence late settlements by request identity, connection generation, answerable generation, and ordinary-session address. Pending, business-error, transport-failure, and stale responses all remain unavailable. Owner events invalidate the runtime's existing resident Session map before live facades reload, so never-materialized and disposed facades cannot strand an off-screen cache. The composer model entry derives visibility from the standing `useSession` selector, so ordinary/addressed transitions converge without a provide-bundle rebuild. InputBar and ChatView use that same selector; image paste and drop preserve the draft and attachment rail while unavailable, and transcript branch actions are absent.

The command registry exposes `has(name)` as a read-only, Agent-free coarse index over every global and scoped registration. A false result proves a definite miss. `session.prompt` rejects that miss as `unknown-command` before Agent lookup, so a cold session remains cold and records no event. A true result permits Agent resolution but grants no scoped availability: the existing `find(agent, name)` remains authoritative after resume, and execution still records the stock `command/run` and `command/done` pair. Neither admission path contains provider, Agent implementation, or command-name exceptions.

## Verification

Runtime tests require pending and failed generations to remain unavailable, disconnect, generation start, and refresh invalidation to clear synchronously, repeated consumers to share one read, addressed children to issue no ordinary model RPC, and late reads or selections to be discarded across generation/address changes. Two subscribers observe the same Session authority while the API records exactly one `session.models` call. Client tests require the stock model entries to subscribe to that same source, owner invalidation to reach resident Sessions with never-materialized or disposed facades, and one mounted composer control to hide and restore across ordinary/addressed transitions. Supported session A to unavailable or declined session B transitions preserve image draft/rail state and expose no branch action. The artifact gate builds the package, runs a real `pnpm pack` into an absolute temp destination, lists the tarball through `tarballFiles`, and compares all 77 official members literally, including 69 declaration files and the three runtime JavaScript files; a required workflow lane invokes that exact artifact graph.

Public Host tests address an unknown command to a persisted cold session and require the stable `unknown-command` response, zero factory resume calls, no live Agent or Session, and an unchanged public session list. A registered command may resume and must retain the command lifecycle pair. Registry tests hold the same name in global and independent scoped layers and dispose them one at a time, proving that the coarse index remains true until the final registration leaves.

## Alternatives considered

**Expose controls optimistically and rely on Host rejection.** The Host remains authoritative, but an enabled control promises an operation the current session may not implement. It also lets paste or drop disturb local draft state before the rejection arrives.

**Reset capability state only in a passive effect.** Effects run after render, so a session or connection switch can commit UI from the previous key. Capability state belongs in the Session generation lifecycle and must clear before the new generation can render.

**Resume every cold session before checking a slash name.** Exact scoped resolution does require an Agent, but a name absent from every registration is already a definite miss. Resuming it creates process state that the rejected command never needed.

**Hardcode unsupported providers or command names in the Host.** Such branches would couple generic DSH admission to one deployment and drift as Agent implementations and command plugins change.

## Consequences

Native controls fail closed across loading, transport failure, Session replacement, and connection-generation changes, while supported sessions regain the same stock controls after their current-generation read succeeds. Business state remains in the resident Session object layer, `contract/` stays declaration-only, and the packed package retains its exact official inventory. Existing Agent factories retain seeded forks without modification; a factory that cannot honor them declares one backward-compatible field.

Unknown slash names cannot wake cold sessions. Because `has(name)` is intentionally coarse, a name registered only for another scope may still cause a resume before exact `find()` rejects it; the index prevents definite misses from resuming but does not replace scoped resolution or advertise availability to clients.
