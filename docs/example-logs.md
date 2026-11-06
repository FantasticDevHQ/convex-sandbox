# Bounded command output

Choose a retained execution on Commands to view stdout and stderr. Cached queries
perform no native requests. **Read next output** makes one shared execution-client
log read, with at most one bounded native page for each stream. The server verifies
operator scope, current binding and the original reviewed account. Recovery reads
remain available after run expiry. Unknown executions without a native history ID
cannot fetch logs or restart the command.

The component owns native stream offsets and log leases. Concurrent reads cannot
publish the same lease twice. After reload or a new host action, the shared client
continues from the retained provider cursor; the browser never supplies or resets
native offsets. The view subscribes to the complete bounded cache, read in at most
two indexed pages of 16 chunks, and replaces its snapshot. It never concatenates
overlapping query results. stdout and stderr remain separate.

The shared cache retains at most 64 KiB or 32 chunks per execution. The view marks
truncation when that bound discards output, when native offsets skip bytes, or
when invalid text requires replacement. Once the cache reaches its bound, the
refresh button is disabled. Raw-offset or agent errors remain visible as safe
error codes, alongside any previously cached bytes. Errors do not advance the
retained cursor. Logs render as text, never as HTML.

An empty page or a drained native stream does not confirm process exit. The
execution state and exit code still come from separate native history inspection.
There is no background polling or cancellation. Each explicit refresh is bounded
and never dispatches another command.

Deterministic tests exercise concurrent reads, retained offsets, output bounds,
native gaps/errors and scope isolation without native resources. Browser fixtures
label their synthetic caches and exercise the production output panel. They do
not verify a live hosted session or qualify Boat support.

Local development uses isolated anonymous backends through the managed worktree
commands. Before hosted configuration, verify the actual FantasticDev team slug/ID,
reuse its correct existing project, and verify the selected deployment. This
workflow grants no production deployment or Boat provisioning authority.
