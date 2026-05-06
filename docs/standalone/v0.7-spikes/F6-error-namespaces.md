<!-- F6-error-namespaces.md - Spike F.6 deliverable for unictl v0.7 -->
<!-- Verified kind count: grep -c '"kind":' packages/cli/src/error-registry.json => 46 -->

# F.6 - Error Code Numeric Namespace Allocation

Spike F.6 of the v0.7 plan locks numeric error code namespaces per domain so
the C9 phase (`code-allocations.json`) can assign every existing kind to a
stable 16-bit code. This document is the source of truth for that allocation.

## Decision (range table)

Stride is `0x1000` (4096 codes) per first-class domain. The single 16-bit
range (`0x0001-0xFFFF`) gives sixteen `0xN000` slots; eight are claimed in
v0.7 and eight are reserved for future domains. Special cross-cutting codes
live in the very low range so they read naturally in logs.

| Range             | Hex (start-end)   | Domain                              | Capacity | Notes                                                                                  |
|-------------------|-------------------|-------------------------------------|----------|----------------------------------------------------------------------------------------|
| 0                 | 0x0000            | reserved (no error)                 | 1        | `ok=true` envelopes carry `code: 0`. Never assigned to a kind.                         |
| 1-15              | 0x0001-0x000F     | special: timeout / generic infra    | 15       | Cross-cutting codes that have no natural domain (e.g. wall-clock timeout).             |
| 16-255            | 0x0010-0x00FF     | validation_* (parse / preflight)    | 240      | Argument-shape and preflight rejections. Flat, dense, exit_code 2.                     |
| 256-4095          | 0x0100-0x0FFF     | reserved (low gap)                  | 3840     | Held for future cross-cutting families (e.g. auth, telemetry) that should sort early.  |
| 4096-8191         | 0x1000-0x1FFF     | editor_* (editor lifecycle)         | 4096     | Editor process state: running / not_running / died / session_changed / busy.           |
| 8192-12287        | 0x2000-0x2FFF     | project_* + profile_*               | 4096     | Project- and BuildProfile-scoped errors. Two related families share a 4K block.        |
| 12288-16383       | 0x3000-0x3FFF     | build_*                             | 4096     | Build runner: build_failed, build_exception, cancelled_by_user, job_not_found, etc.    |
| 16384-20479       | 0x4000-0x4FFF     | test_*                              | 4096     | Test runner: tests_failed, xml_parse_failed, unity_crash, test_heartbeat_stale, etc.   |
| 20480-24575       | 0x5000-0x5FFF     | ipc_* (transport)                   | 4096     | IPC pipe / progress-file plumbing.                                                     |
| 24576-28671       | 0x6000-0x6FFF     | reserved: setting_*                 | 4096     | Phase E: `settings raw-set --no-warranty` and related.                                 |
| 28672-32767       | 0x7000-0x7FFF     | reserved: input_*                   | 4096     | Phase E: `input set` lifecycle.                                                        |
| 32768-36863       | 0x8000-0x8FFF     | reserved: deploy_*                  | 4096     | Phase E: `deploy android keystore set` and future deploy verbs.                        |
| 36864-40959       | 0x9000-0x9FFF     | reserved: scripting_*               | 4096     | Phase E: `scripting set` lifecycle.                                                    |
| 40960-65535       | 0xA000-0xFFFF     | reserved (future domains)           | 24576    | Six unallocated `0xN000` slots for v0.8+. Do not assign before a domain is named.      |

## Rationale

- **Stride 0x1000 (4096 codes/domain).** v0.6 already produced 8-12 kinds in
  the largest domain (`test_*`). Picking a 256-code stride would force a
  re-shuffle within two minor releases as `--wait`-aware verbs (Phase D) and
  the Phase E feature bundles add per-state errors. 4096 codes per domain
  buys decades of headroom and keeps the namespace layout legible in hex.
- **Eight slots used, eight reserved.** The v0.7 plan names exactly eight
  domains across Phase A-E (`editor_`, `project_`, `profile_`, `build_`,
  `test_`, `ipc_`, plus the four Phase E newcomers `setting_`, `input_`,
  `deploy_`, `scripting_`). I pre-assign the Phase E ranges so the C9 PR can
  land without churning this table when Phase E starts.
- **`project_*` + `profile_*` share a slot.** BuildProfile errors are
  semantically a subset of project-state errors (they are project-relative
  paths and depend on Unity version). Sharing 4K codes between them keeps
  related kinds adjacent in `error-reference.md` and still leaves >4080
  codes free in the slot.
- **Special low range (0x0001-0x000F).** Cross-cutting codes such as
  `timeout` (the wall-clock variant emitted by the CLI shell, distinct from
  `test_timeout`) read more naturally as `code: 1` than as `code: 0xC400`.
  Fifteen slots is enough; we have exactly one cross-cutting kind today.
- **0x0100-0x0FFF reserved.** I deliberately leave a 3840-code gap before
  the first domain so v0.8 can introduce a second cross-cutting family
  (e.g. `auth_*`, `telemetry_*`, generic `infra_*`) without scattering it
  into the high reserved range.
- **`validation_*` kept flat.** Validation errors are mostly shaped like
  parse failures rather than domain failures and tend to fan out fast as
  new verbs land. A flat 240-code block (0x0010-0x00FF) keeps them out of
  domain-specific budgets.

## Existing 46 kinds - initial allocation

Codes are assigned next-free within each namespace, in the order kinds
appear in `error-registry.json`. `validation_*` absorbs every kind that
emits exit_code 2 today (per critic 1.6 there are 46, not 47).

| kind                                | code (decimal) | code (hex) | exit_code | Domain slot              |
|-------------------------------------|----------------|------------|-----------|--------------------------|
| timeout                             | 1              | 0x0001     | 124       | special                  |
| invalid_param                       | 16             | 0x0010     | 2         | validation_*             |
| target_unsupported                  | 17             | 0x0011     | 2         | validation_*             |
| project_not_detected                | 18             | 0x0012     | 2         | validation_*             |
| profile_not_found                   | 19             | 0x0013     | 2         | validation_*             |
| profile_invalid_extension           | 20             | 0x0014     | 2         | validation_*             |
| profile_invalid_path                | 21             | 0x0015     | 2         | validation_*             |
| profile_unsupported_on_this_unity   | 22             | 0x0016     | 2         | validation_*             |
| editor_lane_unavailable             | 23             | 0x0017     | 2         | validation_*             |
| editor_busy_playing                 | 24             | 0x0018     | 2         | validation_*             |
| editor_busy_compiling               | 25             | 0x0019     | 2         | validation_*             |
| editor_busy_updating                | 26             | 0x001A     | 2         | validation_*             |
| editor_dirty_scene                  | 27             | 0x001B     | 2         | validation_*             |
| editor_dirty_prefab_stage           | 28             | 0x001C     | 2         | validation_*             |
| editor_reload_active                | 29             | 0x001D     | 2         | validation_*             |
| results_path_unwritable             | 30             | 0x001E     | 2         | validation_*             |
| test_already_running                | 31             | 0x001F     | 2         | validation_*             |
| editor_busy                         | 4096           | 0x1000     | 3         | editor_*                 |
| editor_running                      | 4097           | 0x1001     | 3         | editor_*                 |
| editor_not_running                  | 4098           | 0x1002     | 3         | editor_*                 |
| editor_died                         | 4099           | 0x1003     | 8         | editor_*                 |
| editor_session_changed              | 4100           | 0x1004     | 8         | editor_*                 |
| project_locked                      | 8192           | 0x2000     | 3         | project_* + profile_*    |
| multi_instance                      | 8193           | 0x2001     | 3         | project_* + profile_*    |
| unity_not_found                     | 8194           | 0x2002     | 3         | project_* + profile_*    |
| profile_switch_requires_batch       | 8195           | 0x2003     | 3         | project_* + profile_*    |
| profile_not_applied                 | 8196           | 0x2004     | 3         | project_* + profile_*    |
| build_exception                     | 12288          | 0x3000     | 1         | build_*                  |
| build_failed                        | 12289          | 0x3001     | 1         | build_*                  |
| cancelled_by_user                   | 12290          | 0x3002     | 1         | build_*                  |
| not_cancellable                     | 12291          | 0x3003     | 3         | build_*                  |
| compile_failed                      | 12292          | 0x3004     | 1         | build_*                  |
| job_not_found                       | 12293          | 0x3005     | 3         | build_*                  |
| progress_read_failed                | 12294          | 0x3006     | 125       | build_*                  |
| not_yet_implemented                 | 12295          | 0x3007     | 125       | build_*                  |
| tests_failed                        | 16384          | 0x4000     | 1         | test_*                   |
| no_assemblies                       | 16385          | 0x4001     | 3         | test_*                   |
| xml_parse_failed                    | 16386          | 0x4002     | 4         | test_*                   |
| unity_crash                         | 16387          | 0x4003     | 5         | test_*                   |
| test_timeout                        | 16388          | 0x4004     | 6         | test_*                   |
| test_invalid_filter                 | 16389          | 0x4005     | 7         | test_*                   |
| unknown_test_failure                | 16390          | 0x4006     | 8         | test_*                   |
| test_heartbeat_stale                | 16391          | 0x4007     | 8         | test_*                   |
| xml_save_failed                     | 16392          | 0x4008     | 8         | test_*                   |
| ipc_no_progress_file                | 20480          | 0x5000     | 3         | ipc_*                    |
| ipc_error                           | 20481          | 0x5001     | 3         | ipc_*                    |

Count: 1 special + 16 validation + 5 editor + 5 project/profile + 8 build +
9 test + 2 ipc = **46**. Verified against `error-registry.json`.

Note: `test_timeout` is filed under `test_*`, not `special:timeout`, because
it is a domain-specific exit (exit_code 6, distinct envelope) emitted only
by the test runner. The cross-cutting `timeout` kind (exit_code 124) is the
client-side wait timeout from the CLI shell.

## Reserved / future

- **0x0002-0x000F (14 codes):** unallocated cross-cutting slots. Candidates:
  `interrupted` (SIGINT, exit 130, due in D7), `wait_timeout` (the agent-
  facing rename of `timeout` if D5 keeps both), generic `infra_unavailable`.
- **0x0020-0x00FF (224 codes):** unallocated `validation_*`. Reserved for
  Phase D `--wait` parse errors and Phase E feature-bundle preflights.
- **0x0100-0x0FFF (3840 codes):** held for a second cross-cutting family
  in v0.8+ (auth, telemetry, generic infra).
- **0x1005-0x1FFF (4091 codes):** unallocated `editor_*`. Phase A reload
  envelope adds one (`editor_reload_active` already filed in `validation_*`
  per its current exit_code; if it migrates to editor_* in v0.8 the old
  code is retired, not reused - see policy below).
- **0x2005-0x2FFF (4091 codes):** unallocated `project_* / profile_*`.
- **0x3008-0x3FFF (4088 codes):** unallocated `build_*`.
- **0x4009-0x4FFF (4087 codes):** unallocated `test_*`.
- **0x5002-0x5FFF (4094 codes):** unallocated `ipc_*`.
- **0x6000-0x9FFF:** Phase E pre-allocated, currently empty.
- **0xA000-0xFFFF (24576 codes):** unassigned. Do not allocate without
  naming the domain in this file first.

## Assignment policy (going forward)

1. **Allocation.** When adding a new kind in domain `X`, take the next free
   code in the `X` namespace - do not leave gaps within a single PR. Update
   the "Existing kinds" table and `code-allocations.json` in the same
   commit. The C9 enforcer (`check:error-registry`) rejects PRs that
   produce gaps within a namespace or codes outside the declared range.
2. **Removal.** Kinds may be retired. Their numeric code is **never** reused
   for a different kind. Mark the row in this file with `since_version` and
   `retired_version`; `code-allocations.json` keeps the entry with
   `retired: true`. This is the same additive-only contract A7 applies to
   the heartbeat ABI.
3. **Domain reassignment.** A kind that changes domain (e.g. moves from
   `validation_*` to `editor_*`) gets a **new** code in the new namespace.
   The old code is retired per rule 2. Document the migration in
   CHANGELOG and in F1 (migration guide) when this happens between minors.
4. **Schema versioning.**
   - Adding a kind to an existing namespace: additive, no schema bump.
   - Adding a new domain in a reserved `0xN000` slot: additive, no schema
     bump (consumers must already accept unknown codes per the cross-phase
     versioning policy).
   - Restructuring an existing namespace (changing stride, shrinking a
     range, repurposing a reserved slot): **major bump** of
     `error-registry.schema_version` and `code-allocations.schema_version`.
5. **Range changes.** Edits to the "Decision" table in this file require
   architect sign-off. The table is the input that C9 enforces; it is not
   a description of past decisions.

## Output: code-allocations.json schema

C9 produces `tools/unictl/packages/cli/src/code-allocations.json` from
this allocation. Schema:

```jsonc
{
  "schema_version": 1,
  "ranges": [
    {
      "domain": "validation_*",
      "start": 16,
      "end": 255,
      "stride_hex": "0x00F0",
      "notes": "flat namespace; exit_code 2 by convention"
    },
    {
      "domain": "editor_*",
      "start": 4096,
      "end": 8191,
      "stride_hex": "0x1000",
      "notes": "editor lifecycle"
    }
    // ... one entry per row in the Decision table
  ],
  "allocations": [
    {
      "kind": "invalid_param",
      "code": 16,
      "code_hex": "0x0010",
      "domain": "validation_*",
      "exit_code": 2,
      "since_version": "0.1.0",
      "retired": false
    }
    // ... one entry per existing kind
  ]
}
```

The `check:error-registry` validator enforces:
- `code` is unique across `allocations`.
- `code` falls within the `ranges` entry whose `domain` matches.
- For each `domain`, allocated codes form a contiguous prefix
  `[start, start + n)` with no internal gaps (gaps allowed only across
  domain boundaries).
- `retired: true` entries keep their `code` permanently; new kinds may not
  reuse retired codes.

The C# emitter on the Unity side reads the same file (per R17 drift gate)
and surfaces `(code, kind)` pairs in its envelopes. Drift between the Rust
CLI registry and the C# emitter is a hard CI failure.
