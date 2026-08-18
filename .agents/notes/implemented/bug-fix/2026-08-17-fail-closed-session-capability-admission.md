# Agent Note: Fail-closed session capability admission

Status: implemented

English | [中文](2026-08-17-fail-closed-session-capability-admission.zh.md)

## Problem

An Agent implementation may own text execution while lacking DSH image, model-selection, or seeded-fork behavior. The Host enforced some of those differences, but the native Web conversation initially exposed image intake and branch actions before its capability read settled. A session switch could also render one frame from the previous session's loaded snapshot. Separately, an unknown slash command addressed to a cold persisted session resumed and published its Agent before the Host learned that no handler existed.

These optimistic paths made unavailable controls actionable and let a definite command miss mutate process state before returning an error.

## Decision

`AgentFactory.sessionCapabilities` is an optional factory-wide declaration. Omission preserves stock behavior, including seeded forks; `forkFromSeed: false` denies generic fork admission. The registry reads the declaration from the factory that owns a live Agent or the active factory that would resume a cold session without performing that resume. The Host returns `imageInput`, `modelSelection`, and `fork` in `session.models.capabilities` and enforces the same facts in the corresponding write paths.

The runtime Session owns capability state as `ConversationSnapshot.sessionCapabilities`; the UI owns no parallel store or subscription hook. A Session reads `session.models` at most once for each ready connection generation. Generation start invalidates the current request and clears the snapshot field synchronously; a response may publish only while its request identity, connection generation, and answerable generation still match. Pending, error, transport failure, and stale responses all remain unavailable. InputBar and ChatView consume the existing `useSession` selector, so independent controls share the same read. Image paste and drop preserve the draft and attachment rail while unavailable, and transcript branch actions are absent.

The command registry exposes `has(name)` as a read-only, Agent-free coarse index over every global and scoped registration. A false result proves a definite miss. `session.prompt` rejects that miss as `unknown-command` before Agent lookup, so a cold session remains cold and records no event. A true result permits Agent resolution but grants no scoped availability: the existing `find(agent, name)` remains authoritative after resume, and execution still records the stock `command/run` and `command/done` pair. Neither admission path contains provider, Agent implementation, or command-name exceptions.

## Verification

Runtime tests require pending and failed generations to remain unavailable, generation start to clear synchronously, repeated readiness to issue at most one read, and a stale generation's late success to be discarded. Two subscribers receive the same successful Session publication while the API records exactly one `session.models` call. Client tests switch from supported session A to unavailable or declined session B and require B's first render to preserve image draft/rail state and expose no branch action. The artifact gate builds the package, runs a real `pnpm pack`, lists the tarball through `tarballFiles`, and compares all 77 official members literally, including 69 declaration files and the three runtime JavaScript files.

Public Host tests address an unknown command to a persisted cold session and require the stable `unknown-command` response, zero factory resume calls, no live Agent or Session, and an unchanged public session list. A registered command may resume and must retain the command lifecycle pair. Registry tests hold the same name in global and independent scoped layers and dispose them one at a time, proving that the coarse index remains true until the final registration leaves.

## Alternatives considered

**Expose controls optimistically and rely on Host rejection.** The Host remains authoritative, but an enabled control promises an operation the current session may not implement. It also lets paste or drop disturb local draft state before the rejection arrives.

**Reset capability state only in a passive effect.** Effects run after render, so a session or connection switch can commit UI from the previous key. Capability state belongs in the Session generation lifecycle and must clear before the new generation can render.

**Resume every cold session before checking a slash name.** Exact scoped resolution does require an Agent, but a name absent from every registration is already a definite miss. Resuming it creates process state that the rejected command never needed.

**Hardcode unsupported providers or command names in the Host.** Such branches would couple generic DSH admission to one deployment and drift as Agent implementations and command plugins change.

## Consequences

Native controls fail closed across loading, transport failure, Session replacement, and connection-generation changes, while supported sessions regain the same stock controls after their current-generation read succeeds. Business state remains in the resident Session object layer, `contract/` stays declaration-only, and the packed package retains its exact official inventory. Existing Agent factories retain seeded forks without modification; a factory that cannot honor them declares one backward-compatible field.

Unknown slash names cannot wake cold sessions. Because `has(name)` is intentionally coarse, a name registered only for another scope may still cause a resume before exact `find()` rejects it; the index prevents definite misses from resuming but does not replace scoped resolution or advertise availability to clients.
