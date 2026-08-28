# Agent Note: Insecure-origin browser UUID compatibility

Status: implemented

English | [中文](2026-08-28-insecure-origin-browser-uuid.zh.md)

## Problem

The authenticated Web client supports explicitly trusted private-LAN authorities over plain HTTP, but such browser origins are not secure contexts. Browsers may expose `crypto.getRandomValues` there while withholding `crypto.randomUUID`. Client packages that call `crypto.randomUUID` during the readiness handshake fail before sending `host.describe`, then connection cleanup closes both otherwise healthy WebSocket downlinks. A transport and gateway probe can therefore pass while the page remains disconnected.

## Decision

The immediately loaded `@deepseek-ai/dsh-client-connection` browser apply preserves a native `crypto.randomUUID` when present. When the method is absent, it installs an RFC 4122 version 4 implementation backed by `crypto.getRandomValues` before mounting the API client or loading downstream client plugins.

The compatibility method lives in the connection package's private `random-uuid.ts` module. That package already owns stage-one browser wire bootstrap and already supplies its local RPC and fixture UUIDs from the same generator. Installing once at this boundary also covers bundled consumers such as API-proxy RPC correlation and client message identity without adding a public package or repeating fallbacks at each call site.

Plain HTTP remains an insecure transport. This compatibility only makes the existing authenticated, explicitly trusted private-LAN deployment work in the browser environment that contract already permits.

## Alternatives considered

**Require HTTPS for all LAN access.** Rejected for this fix because certificate provisioning and trust distribution are outside the current private-LAN gateway contract; changing that deployment contract would not correct the shipped plain-HTTP path.

**Add a fallback at every `crypto.randomUUID` call site.** Rejected because it duplicates security-sensitive UUID code, is easy to apply incompletely, and makes future bundled client packages repeat the same environment check.

**Create a new shared UUID package.** Rejected because it expands the package and artifact graph for one browser-bootstrap compatibility rule. The immediate connection plugin already executes before the affected downstream clients and is the narrowest existing owner.

## Consequences

- Secure-context browsers continue using their native implementation without replacement.
- Insecure origins require `crypto.getRandomValues`; environments lacking Web Crypto still fail rather than falling back to weak randomness.
- The connection apply mutates the browser `crypto` object once before downstream client plugins load.
- The change restores browser readiness on authenticated, explicitly trusted plain-HTTP LAN origins but adds no confidentiality or transport integrity.

## Testing

The connection apply test mounts the real `WebApiClient` with an insecure-origin-shaped `crypto` object and proves `host.describe` and `respond` reach HTTP. A companion case proves a native `randomUUID` implementation is preserved. The assembled Web test loads the built client bundles in production order without `crypto.randomUUID`, reaches the rendered Session tree, and proves downstream UUID creation remains available.
