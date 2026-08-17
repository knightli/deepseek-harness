# Agent Note: Repository-relative CSS Module identities

Status: implemented

English | [中文](2026-08-17-repository-relative-css-module-identities.zh.md)

## Problem

The Client bundle plugin passed an absolute stylesheet path to Lightning CSS. Lightning CSS includes that filename in the CSS Module hash, so two clean checkouts of the same commit emitted different class identities and different `lib/client.js` bytes. Reproducible package materialization could not distinguish source drift from checkout-location drift.

## Decision

The CSS Module loader reads and watches the absolute stylesheet path but passes a repository-relative POSIX path to Lightning CSS as `filename`. The conversion rejects an empty path, an absolute result, and every parent traversal, so a stylesheet outside the checkout cannot acquire an in-repository identity.

The repository-relative path remains part of the identity. Identical source paths therefore produce identical class names across checkout roots, while distinct package or stylesheet paths remain separate inputs to the hash.

## Verification

The Client bundle CSS test computes Lightning CSS identities for the same relative stylesheet under two absolute roots and requires equality. It also requires different relative paths to produce different identities, verifies that an outside path fails, and continues to prove that the loader watches the absolute source file.

## Alternatives considered

**Accept different package bytes from different checkout roots.** This would make artifact provenance depend on an unrecorded machine path and defeat independent fresh-build comparison.

**Rewrite generated class names after bundling.** Post-processing would need to understand JavaScript, embedded CSS, and source maps as one artifact. It would create a second transformation pipeline after the supported compiler.

**Build every artifact at one fixed absolute path.** A global path would serialize unrelated builds, retain stale state after interruption, and still encode machine-specific filesystem layout into published bytes.

## Consequences

CSS Module identities are reproducible across clean checkout locations and remain sensitive to repository-relative file placement. Stylesheets consumed by this build plugin must reside inside the repository root; an escaped path now stops the build before reading it as a CSS Module identity input.
