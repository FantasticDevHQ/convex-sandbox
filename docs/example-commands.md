# Detached commands

Open Commands from an owned machine detail, or enter its logical key at
`/commands`. Operator authorization resolves the scope on the server. A URL
never grants access. The machine must have an owned, running Boat binding and
no other unfinished operation before a new command can start.

Choose literal arguments or a shell command. Each line in the argument field is
one literal argument. The example accepts at most 32 arguments of 512 characters
each, a 256-character executable or a 4096-character shell command. Optional
working directories are relative to `/home/user`, at most 256 characters, and
cannot traverse through `..`. Per-command environment and runtime timeout are
unsupported. Commands can change guest files.

New execution requires the original reviewed account, active operator authority,
and an approved run within both its absolute expiry and duration. Server-only
credentials stay in trusted actions. The host uses public execution stores and
the shared Boat client; it does not own another native lifecycle.

The app puts the original operation ID in the URL before submitting. The
component retains its execution and native history ID, so reload subscribes to
the same record. The bounded history list loads 20 component operations per page
and filters to executions of the current binding. Inspection reads native
command history and shows its reported exit code. Cached queries perform no
native requests. Inspection remains available after run expiry for recovery.

A lost start reply retains an unknown outcome. Inspection never starts a command,
and repeating the original start identity returns its retained record. Without
a native history ID, the app cannot safely discover that execution. Keep the
original operation; do not treat a process ID as a recovery handle. Cancellation
is unsupported. Composing another command is an explicit new operation and does
not resolve earlier unknown work.

The ordinary backend and browser tests use deterministic synthetic replies and
perform no provisioning. Browser fixtures exercise the production panel and label
their synthetic state. They do not qualify the provider or prove a hosted run.

Local development uses managed, isolated anonymous backends. Any hosted example
project/database must belong to FantasticDev. Verify the actual team slug/ID,
reuse the correct existing project, and verify the selected deployment before
configuration. No hosted deployment or Boat provisioning is authorized by setup.
