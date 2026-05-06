# F.2 -- PID Liveness File Lock Strategy

## Decision

Use **lockfile-on-rename** (write to `runtime.json.tmp.<pid>` then `File.Move`
overwrite onto `runtime.json`), matching the pattern already established by
`TestProgressFile.cs` and `BuildRunner.cs`.

## Rationale

unictl's write profile for `runtime.json` is narrow and one-sided: the
Unity-side managed code is the sole writer. The CLI is always a reader. True
concurrent writers (two managed agents, or managed + CLI both writing) are
excluded by Unity's single-editor-per-project constraint and by the fact that
CLI never writes this file. That narrows the problem to one active concern:
**a CLI reader landing in the middle of a managed write**.

The lockfile-on-rename strategy eliminates the torn-read concern completely.
`File.Move` on NTFS (same volume, no cross-device) and APFS is atomic from
the reader's perspective: the reader either sees the old complete file or the
new complete file. It never sees a partial write because the partial content
lives in the `.tmp.<pid>` sidecar until the move lands.

flock-style advisory locking (`FileStream` with `FileShare.None`) would also
work, but it adds a retry loop on the CLI side, requires careful timeout
budgets, and `FileShare.None` is a cooperative convention -- a third-party
process (AV scanner, Dropbox, Windows Search indexer) can hold an exclusive
handle briefly and cause spurious failures. The hint table already documents
this failure class for progress files (`progress_read_failed`). There is no
benefit to replicating that complexity for `runtime.json`.

Best-effort writes are rejected because `runtime.json` carries liveness
semantics. A CLI caller deciding "editor is running" based on a half-written
PID field is a correctness defect, not a transient inconvenience. The parse
retry that best-effort requires is equivalent work to the rename approach but
with weaker guarantees.

Consistency with the existing codebase is a secondary but real factor. Both
`TestProgressFile.Write` and the two write sites in `BuildRunner` already
follow write-tmp-then-move. Auditing future contributors' mental model costs
less when one pattern is used uniformly.

## Implementation sketch

**Managed-side writer (C#)**

```csharp
// Runtime path: Library/unictl/runtime.json
// Tmp path:     Library/unictl/runtime.json.tmp.<pid>

static void WriteRuntimeJson(RuntimeRecord record)
{
    string dir      = Path.Combine(Application.dataPath, "..", "Library", "unictl");
    string finalPath = Path.Combine(dir, "runtime.json");
    string tmpPath   = finalPath + ".tmp." + record.pid.ToString();

    Directory.CreateDirectory(dir);

    string json = JsonConvert.SerializeObject(record, Formatting.None);
    File.WriteAllText(tmpPath, json, System.Text.Encoding.UTF8);

    // Overwrite-replace: atomic on same NTFS/APFS volume.
    // File.Move with overwrite param (Unity/.NET 6+):
    File.Move(tmpPath, finalPath, overwrite: true);
}
```

On graceful shutdown (B4a), the same writer is called with
`terminal_reason = "quit"` before any delete attempt. The rename guarantees
that a CLI reader polling immediately after the quit event sees the complete
terminal record, not a half-written one.

**CLI-side reader (Rust)**

```rust
// Returns Ok(None) if file absent; Err only on unrecoverable I/O.
fn read_runtime_json(library_dir: &Path) -> Result<Option<RuntimeRecord>, Error> {
    let path = library_dir.join("unictl/runtime.json");

    let content = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    match serde_json::from_str::<RuntimeRecord>(&content) {
        Ok(r)  => Ok(Some(r)),
        Err(_) => {
            // Single retry after 5 ms to ride out a rename that landed
            // between our open() and read_to_string().
            std::thread::sleep(Duration::from_millis(5));
            let content2 = fs::read_to_string(&path)?;
            Ok(Some(serde_json::from_str(&content2)?))
        }
    }
}
```

The single retry after 5 ms handles the one residual race: on Windows, even
an atomic rename does not prevent a reader from opening the file descriptor
before the move and reading zero bytes if the OS flushes the directory entry
before the data. The 5 ms budget is negligible against the CLI's overall
command latency and does not loop indefinitely.

## Failure modes & handling

**Partial write visible to reader**: Cannot happen. The partial content lives
in the `.tmp.<pid>` sidecar until `File.Move` succeeds. The reader never
opens the sidecar.

**Concurrent writer (two processes both calling WriteRuntimeJson)**: Not
expected under the single-editor constraint. If it somehow occurs (e.g. hot
reload triggers two simultaneous `InitializeOnLoad` callbacks), both writers
produce their own `.tmp.<pid>` file (distinct names because PIDs differ or
are the same process). The last `File.Move` wins. The result is a complete,
valid JSON from one of the two writers -- not a torn interleaving. The
`started_at_ms` field lets the CLI detect which write won.

**Cross-volume tmp path**: `File.Move` throws `IOException` if source and
destination are on different volumes. This cannot occur here because
`runtime.json` and its `.tmp.<pid>` sibling are both under `Library/unictl/`
on the same Unity project volume. No cross-volume scenario exists in normal
unictl usage.

**ENOENT during reader open**: The file may be absent between a clean delete
(B4b) and the next editor startup. The CLI reader returns `Ok(None)` and
reports `editor_not_running` as documented. Not an error.

**Stale `.tmp.<pid>` left behind on crash**: If the Unity editor crashes
between `File.WriteAllText(tmpPath, ...)` and `File.Move(...)`, the sidecar
remains. It is harmless: it has a PID-unique name and is never read by the
CLI. Startup can optionally sweep stale `.tmp.*` files under `Library/unictl/`
as part of B5 crash detection.

**AV/indexer holds on `runtime.json`**: `File.Move` with overwrite on Windows
can fail if a third-party process holds an exclusive handle on the destination.
The writer should catch `IOException` and retry up to three times with 10 ms
backoff before logging a warning and abandoning (matching the tolerance used
for progress files). A failed write is non-fatal: the old complete record
remains visible to readers rather than a torn new one.

## Test plan (Phase B references this)

The 100-iteration concurrent-write test proceeds as follows:

**Setup**: One Unity test fixture (or standalone .NET test) that calls
`WriteRuntimeJson` from two threads simultaneously -- one writing
`{pid: 1, terminal_reason: ""}` and one writing `{pid: 2, terminal_reason: "quit"}`.
The reader thread (`read_runtime_json` equivalent in C# for unit purposes)
samples the file 10 times per write cycle with 0 ms delay between samples.

**Per-iteration assertion**: Every sample that successfully parses must
produce either the `pid=1` record or the `pid=2` record in full. A partial
parse (missing fields, malformed JSON, zero-byte read) fails the assertion.
`JsonConvert.DeserializeObject` throwing on the sample is recorded as a torn
read. Zero torn reads across 100 iterations is the pass criterion.

**Simulating reader during writer window**: Insert a `Thread.Sleep(0)` (a
yield point, not a wall-clock sleep) between `File.WriteAllText(tmpPath, ...)` and
`File.Move(tmpPath, finalPath, overwrite: true)` in an instrumented test
variant. This maximizes the window during which the reader might attempt to
open `runtime.json`. Because the move has not yet landed, the reader sees the
previous complete file -- not the sidecar -- so the read either returns the
old valid record or `NotFound`. Both are acceptable. Torn reads remain
impossible.

**Platform coverage**: Run on Windows (NTFS, same volume) and macOS (APFS).
Both are required by B7.

**Regression gate**: Add an entry to `mise run check:heartbeat` that runs
this test as part of the Phase B validation suite.

## Decision rejected: flock-style advisory lock

`FileStream` with `FileShare.None` on the writer side forces CLI readers into
a retry loop. The retry budget interacts poorly with AV scanners and indexers
that may hold the file briefly. The hint table for `progress_read_failed`
already documents that class of failure. Replicating it for `runtime.json`
adds surface area without improving the torn-write guarantee, which the rename
approach already provides unconditionally.

## Decision rejected: best-effort writes

Best-effort requires the CLI reader to retry on parse failure. For heartbeat
data (A-series) that is an acceptable tradeoff because staleness tolerance is
explicit. For `runtime.json`, the CLI uses the record to make a binary
"editor alive / editor dead" decision. A torn read silently producing a zero
PID or an empty `terminal_reason` is a correctness defect with observable user
impact (false "editor not running" or false "editor crashed"). The retry loop
that best-effort mandates is equivalent implementation cost to the rename
approach but cannot guarantee the reader never sees partial state.
