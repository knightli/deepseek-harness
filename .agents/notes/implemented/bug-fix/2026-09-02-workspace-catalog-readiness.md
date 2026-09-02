# Agent Note: Workspace catalog readiness

Status: implemented

English | [中文](2026-09-02-workspace-catalog-readiness.zh.md)

## Problem

The Workspace browser combines independently fetched Session and Workspace lists. Rendering after either partial response makes a transient subset look complete, enables actions against incomplete membership, and lets dependent diagnostics inspect changing catalog state.

## Decision

The runtime's standard Session snapshot exposes its existing pull activity and error as optional additive fields, while the official runtime always publishes them. The fields remain optional so existing plugin test doubles and compatible runtime implementations do not need an immediate source change.

`WorkspaceBrowser` derives one catalog readiness value directly from the Session and Workspace snapshots. It withholds the tree and catalog actions until `baselinesReady` is true, preserves the last jointly settled Session/Workspace view during later refreshes, and presents stable retry copy without raw transport errors. Retry invokes the two existing runtime refresh methods; Host implementations retain authority over request coalescing.

This is presentation coordination over existing object-layer facts. The retained view snapshot is read-only and non-authoritative: writes and refreshes still go through the existing Session and Workspace stores, and the snapshot is replaced only after both stores jointly settle. It creates no second catalog authority.

## Alternatives considered

**Render each list as soon as it arrives.** Rejected because the browser presents the two lists as one directory and cannot label partial membership as a complete result.

**Copy catalog data into an authoritative browser-owned store.** Rejected because it creates competing state, synchronization rules, and stale-data failure modes. The existing runtime snapshots continue to own every required fact; the browser retains only the latest jointly settled presentation snapshot.

**Make the additive Session fields and refresh methods mandatory immediately.** Rejected because it breaks otherwise compatible plugin implementations and test doubles. Official runtimes provide the data, while optional outward declarations preserve source compatibility.

## Consequences

- Initial startup has one explicit loading or retry boundary instead of a changing partial tree.
- Background refresh leaves the last complete directory usable and labels it when stale.
- Catalog actions do not run against an initial partial membership projection.
- Compatible third-party implementations may omit the additive fields; the browser then derives a conservative state from the established arrival phase.

## Testing

The Workspace browser component suite covers initial loading, initial failure and retry, complete-tree refresh, and stale-result presentation. Client type checking verifies the additive runtime and slot interfaces.
