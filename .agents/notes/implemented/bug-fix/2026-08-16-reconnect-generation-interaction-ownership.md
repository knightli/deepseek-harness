# Agent Note: Reconnect generation ownership for interactions

Status: implemented

English | [中文](2026-08-16-reconnect-generation-interaction-ownership.zh.md)

## Problem

The browser connection owns independent mux and host streams. When either stream ends, the controller aborts the connection generation and starts another, but an asynchronous sibling iterator may still yield an already queued envelope after abort. Delivering that envelope after the next generation starts assigns old transport data to new runtime state.

The native interaction UI has a separate timing race. A reconnecting Host replays a pending approval or question as soon as its mux stream opens, before the readiness handshake calls `onConnected`. Clearing every pending wait during the subsequent Session resync removes the replayed live request from the visible conversation even though the Host still waits for it. Keeping the prior response function active instead risks answering a dead RPC id.

## Decision

`ConnectionController` allocates a monotonically increasing generation and calls `onGenerationStart` before either stream can deliver an envelope. Every pump captures that generation and its `AbortController`; it invokes a business sink only while both are still current. The controller retains both iterator and pump promises, aborts and calls `return()` on each iterator, then joins both pumps before replacing the generation or settling its awaitable `stop()`. Stream cancellation remains best effort, but an abort-insensitive sibling cannot publish late data into a later generation or remain owned after teardown.

`SessionManager` and each resident `Session` tag pending approvals and questions with the generation that delivered them. Disconnect preserves instantiated waits and sidebar status as visible Host-owned state but makes every response function reject locally. It discards answerable frames buffered for an uninstantiated Session because their dead RPC ids have no rendered owner. New-generation replay replaces live identities before readiness; ready reconciliation removes stale statuses that were not replayed even from a resident Session that is still cold, preserves waits replayed by the ready generation, and enables responses only for that generation.

`ConnectionHandle.connectionState` exposes one stable observable source for `connected` and `reconnecting`. `ui-layout` passes it through the existing injected-hook channel. During reconnect, `AppFrame` renders the existing `ConnectionBanner` outside its application subtree and makes the same three-column root `<fieldset>` disabled and inert. Reset fieldset CSS preserves the grid geometry, and no sidebar, conversation, composer, history, status, or interaction component is replaced.

## Verification

Connection tests use an abort-insensitive sibling stream and prove that a frame offered to both old and current streams reaches the business sink once, that stopping explicitly closes the sibling iterator, and that stop settles even while describe and stream-open callbacks remain pending. Runtime wire tests drive generation start, disconnect, replay-before-ready, ready reconciliation (including a resident cold Session), response, and resolution through the public connection sinks and Session snapshots. Layout component tests prove that reconnect shows the banner, disables and inerts the native frame, disables descendant controls, and reverses those states after recovery. A keyless assembled snapshot boots the real built Client bundles, breaks the fixture streams, observes the stock reconnect banner and disabled native approval, then proves that ready-generation replay makes that same interaction usable again.

## Alternatives considered

**Clear interactions immediately on disconnect or at `onConnected`.** Immediate clearing presents an unresolved Host request as absent. Clearing at `onConnected` races with replay that legitimately arrives after stream open but before readiness.

**Keep the previous response functions usable until replay.** The RPC id belongs to the failed physical connection and cannot be proven answerable. Local rejection prevents a stale action from reaching the carrier.

**Trust every transport to stop yielding as soon as its AbortSignal fires.** `AsyncIterable` cancellation is cooperative, and a queued item can survive abort. The connection owner must enforce generation membership at the point where an envelope enters business state.

**Add a reconnect store or replace interaction surfaces.** Connection state already has an object-layer owner and the slot renderer already binds observable sources into hooks. A second store or parallel interaction UI would duplicate authority and bypass native DSH composition.

## Consequences

A visible approval or question may remain on screen during an outage even if the Host resolves it while disconnected. It is explicitly non-answerable, the reconnect banner explains the unavailable application state, and ready replay reconciliation removes it when the Host no longer reports it. This favors preserving the last observed Host truth over claiming an unobserved resolution.

The connection package gains one public observable, one generation callback, and an awaitable stop handle; the runtime carries generation metadata beside transient waits, and the layout package depends on the connection service and UI primitives. No durable event, wire frame, Session log format, provider behavior, or application store changes.
