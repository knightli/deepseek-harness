# Agent Note: Fail-closed session capability admission

Status: implemented

English | [中文](2026-08-17-fail-closed-session-capability-admission.zh.md)

## Problem

An Agent implementation may own text execution while lacking DSH image, model-selection, or seeded-fork behavior. The Host enforced some of those differences, but the native Web conversation initially exposed image intake and branch actions before its capability read settled. A session switch could also render one frame from the previous session's loaded snapshot. Separately, an unknown slash command addressed to a cold persisted session resumed and published its Agent before the Host learned that no handler existed.

These optimistic paths made unavailable controls actionable and let a definite command miss mutate process state before returning an error.

## Decision

`AgentFactory.sessionCapabilities` is an optional factory-wide declaration. Omission preserves stock behavior, including seeded forks; `forkFromSeed: false` denies generic fork admission. The registry reads the declaration from the factory that owns a live Agent or the active factory that would resume a cold session without performing that resume. The Host returns `imageInput`, `modelSelection`, and `fork` in `session.models.capabilities` and enforces the same facts in the corresponding write paths.

The native conversation treats a capability as unavailable until a matching read succeeds. Its loaded snapshot records both the exact `sessionId` and capability-reader identity; every render whose current key differs returns the shared unavailable value synchronously. Image paste and drop preserve the draft and attachment rail while unavailable, and transcript branch actions are absent.

The command registry exposes `has(name)` as a read-only, Agent-free coarse index over every global and scoped registration. A false result proves a definite miss. `session.prompt` rejects that miss as `unknown-command` before Agent lookup, so a cold session remains cold and records no event. A true result permits Agent resolution but grants no scoped availability: the existing `find(agent, name)` remains authoritative after resume, and execution still records the stock `command/run` and `command/done` pair. Neither admission path contains provider, Agent implementation, or command-name exceptions.

## Verification

Client tests load image and fork support for session A, switch to session B whose read resolves false, remains pending, or rejects, and require B's first render to be unavailable. Paste and drop must emit `This session does not support image input.` without changing the draft or attachment rail, and B must expose no branch action. A separate case changes only the reader identity and requires the same first-render fence.

Public Host tests address an unknown command to a persisted cold session and require the stable `unknown-command` response, zero factory resume calls, no live Agent or Session, and an unchanged public session list. A registered command may resume and must retain the command lifecycle pair. Registry tests hold the same name in global and independent scoped layers and dispose them one at a time, proving that the coarse index remains true until the final registration leaves.

## Alternatives considered

**Expose controls optimistically and rely on Host rejection.** The Host remains authoritative, but an enabled control promises an operation the current session may not implement. It also lets paste or drop disturb local draft state before the rejection arrives.

**Reset capability state only in a passive effect.** Effects run after render, so a session or connection switch can commit UI from the previous key. Key comparison must happen during render.

**Resume every cold session before checking a slash name.** Exact scoped resolution does require an Agent, but a name absent from every registration is already a definite miss. Resuming it creates process state that the rejected command never needed.

**Hardcode unsupported providers or command names in the Host.** Such branches would couple generic DSH admission to one deployment and drift as Agent implementations and command plugins change.

## Consequences

Native controls fail closed across loading, transport failure, session switches, and connection-reader replacement, while supported sessions regain the same stock controls after their exact read succeeds. Existing Agent factories retain seeded forks without modification; a factory that cannot honor them declares one backward-compatible field.

Unknown slash names cannot wake cold sessions. Because `has(name)` is intentionally coarse, a name registered only for another scope may still cause a resume before exact `find()` rejects it; the index prevents definite misses from resuming but does not replace scoped resolution or advertise availability to clients.
