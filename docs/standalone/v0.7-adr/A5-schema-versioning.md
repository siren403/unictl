<!-- A5 — Schema versioning policy (2026-05-06) -->

# A5 — Schema Versioning Policy

unictl v0.7 introduces three independently versioned JSON schemas. This document is the canonical reference for how each evolves; downstream phases (B, C, D, E) cross-reference it instead of restating the rules.

## Schemas in scope

| Schema | Carrier | Authority | Initial version |
|--------|---------|-----------|-----------------|
| Heartbeat state JSON | `unictl_heartbeat` payload + `last_state` field of `/liveness` response | A1 ADR; produced by managed (`UnictlHeartbeat.cs`), consumed by `/liveness` callers | 1 |
| `runtime.json` (Phase B) | `Library/unictl/runtime.json` | B1 schema (in plan) | 1 |
| Error registry / `--describe` output (Phase C) | `error-registry.json`, per-verb `--describe` JSON | C1 + C2 schemas | 1 |

All three carry a top-level `schema_version: <int>` field.

## Bump rules (uniform)

| Change | Bumps `schema_version`? |
|--------|-------------------------|
| Add a new optional field | **No** — additive, consumers must accept unknown fields |
| Add a new value to an enum | **No** — additive, consumers must treat unknown enum values as opaque or fall back |
| Rename a field | **Yes (major)** — this is breaking |
| Remove a field | **Yes (major)** |
| Change a field's type or unit (e.g. ms → µs) | **Yes (major)** |
| Add a new **required** field | **Yes (major)** — old producers won't ship it |
| Loosen validation (e.g. range widened) | **No** — within-range values still valid |
| Tighten validation (e.g. range narrowed) | **Yes (major)** — old data may now fail |

"Major" bump means consumers MUST check `schema_version` and refuse / migrate if the major version exceeds what they support. Within a major version, additive changes are guaranteed forward-compatible.

Patch / minor distinctions are not used at the schema level — every change is either invisible (additive) or major (potentially breaking).

## Producer obligations

- Always emit `schema_version` as the **first field** of the JSON object so consumers using simple prefix-match parsers see it before deciding how to parse the rest.
- Never reuse a retired field name with different semantics. Once a field is removed, its name is dead — pick a new name if similar semantics return.
- Document every field's units / value space inline in the producer (managed C# for heartbeat, Rust for `runtime.json`, both for `--describe`).

## Consumer obligations

- Check `schema_version` before assuming any field is present.
- Tolerate unknown fields silently. Do not error on unrecognized JSON keys.
- Tolerate unknown enum values: treat as opaque, log at debug level, fall back to neutral behavior.
- If `schema_version > supported_max`, refuse with a clear error (`code: schema_version_unsupported`, kind in `validation_*` namespace per F.6).

## ABI vs schema

The native ABI (`unictl_heartbeat`, `unictl_get_liveness`, etc.) carries `native_version` in `/liveness` responses. ABI versioning is **separate** from schema versioning:

- ABI: bumps `native_version` when adding new exports (additive only post-A7 per A1 ADR).
- Schema: bumps `schema_version` when a payload's structure changes incompatibly.

A consumer checking compatibility must look at both — ABI version tells you which exports are available; schema version tells you how to parse payloads. They evolve independently because adding a new export does not change existing payload shapes, and vice versa.

## Cross-references

- A1 ADR §"Additive-only ABI contract" — ABI versioning rules
- A4 reload-semantics doc — HTTP status vs envelope `kind` split (envelope is part of the schema)
- F.6 namespaces doc — error code allocation (codes are stable across schema bumps; new codes added additively)
- F.8 ABI policy ADR — JSON-over-pipe is the canonical wire format; no shared structs

## Check at release time

`mise run check:error-registry` enforces:
- No `schema_version` decrease across commits
- No silent field removal (each removal must be paired with a major bump)
- New fields are documented in the registry's `fields[]` array

A3+ adds analogous checks for the heartbeat schema and `runtime.json`. C9 wires error-registry conformance into `mise run check`.
