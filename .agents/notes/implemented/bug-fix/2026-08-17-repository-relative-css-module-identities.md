# Agent Note: Repository-relative CSS Module identities

Status: implemented

English | [中文](2026-08-17-repository-relative-css-module-identities.zh.md)

## Problem

The Client bundle plugin passed an absolute stylesheet path to Lightning CSS. Lightning CSS includes that filename in the CSS Module hash, so two clean checkouts of the same commit emitted different class identities and different `lib/client.js` bytes. Reproducible package materialization could not distinguish source drift from checkout-location drift.

## Decision

The CSS Module resolver encodes only a repository-relative POSIX path in its virtual module id. Before resolving an id or reading and watching its file, the plugin applies `realpath` to both the configured repository root and stylesheet and requires the physical file to remain inside the physical root. It derives the virtual id and Lightning CSS `filename` from that canonical relative path. Empty paths, absolute paths, backslashes, drive/stream separators, noncanonical segments, parent traversal, and a root-internal symlink or junction escaping outside all fail before file I/O, so neither a checkout root nor an escaped file can enter generated module identity.

The repository-relative path remains part of the identity. Identical source paths therefore produce identical class names and Rolldown region comments across checkout roots, while distinct package or stylesheet paths remain separate inputs to the hash. The loader also sorts Lightning CSS export keys before constructing the serialized JavaScript class map, removing transform insertion order as a byte-level input without changing any key or value.

## Verification

The Client bundle CSS test creates identical stylesheets under two different absolute checkout roots and requires equal virtual ids, generated module source, and complete Rolldown bundle bytes. It also requires different relative paths to produce different identities, proves invalid and outside virtual ids fail before read/watch I/O, and continues to prove that the loader watches the canonical absolute source file. A cross-platform fixture uses a directory symlink, or a Windows junction, from inside the repository root to an outside stylesheet and requires both resolution and a forged virtual-id load to fail without registering a watch. Repeated CSS export permutations must serialize identically, while a changed key or value must change the output.

## Alternatives considered

**Accept different package bytes from different checkout roots.** This would make artifact provenance depend on an unrecorded machine path and defeat independent fresh-build comparison.

**Rewrite generated class names after bundling.** Post-processing would need to understand JavaScript, embedded CSS, and source maps as one artifact. It would create a second transformation pipeline after the supported compiler.

**Build every artifact at one fixed absolute path.** A global path would serialize unrelated builds, retain stale state after interruption, and still encode machine-specific filesystem layout into published bytes.

## Consequences

CSS Module identities and generated client-bundle bytes are reproducible across clean checkout locations and remain sensitive to repository-relative file placement and export content. Stylesheets consumed by this build plugin must physically reside inside the repository root and use a canonical relative virtual id; lexical containment through an escaping symlink or junction is insufficient. Malformed or escaped identities stop the build before file access. Compiler region comments, CSS Module hashing, and source maps remain enabled, with no post-build rewriting step.
