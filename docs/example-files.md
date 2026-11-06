# Owned home files

Open Files from an owned machine detail or enter its logical key at `/files`.
The server resolves operator scope and checks the selected native ID and binding
generation. A URL never grants access. Rebinding remounts the editor; in-flight
responses from the old editor cannot populate the new binding.

The workspace allows direct files under `/home/user/demo`. Before first use,
prepare that directory in the approved guest through Commands with literal
executable `/usr/bin/mkdir` and two arguments, `-p` and `/home/user/demo`.
This is an explicit command under the existing run approval, not an automatic
shell fallback. If the directory is absent, file requests fail visibly.

Names start with a letter or digit and contain up to 80 ASCII letters, digits,
dots, underscores or hyphens. Nested paths, traversal, encoded escapes and other
directories are refused before any native request, including account readiness
reads. The public file store applies the same path policy to returned list
entries. Listings show at most 50 files, omit symlinks/subdirectories and report
partial results. Native directory pagination is unsupported.

This is a lexical policy, not a symlink jail. A trusted guest can create symlinks
that redirect access even through an allowed name. Use only a directory whose
guest contents you trust; do not claim filesystem containment against hostile
guest processes. The app does not follow list entries to widen its policy.

All inline reads and writes use the public shared file client with a 64 KiB byte
bound. The editor supports UTF-8 text and preserves BOM characters. Save encodes
the text to bytes, writes once, reads back and compares every byte before showing
verification. The backend accepts bounded binary bytes too; binary files that
fail strict UTF-8 decoding are not editable in this UI. Oversized UTF-8 input is
disabled in the browser and independently rejected on the server before dispatch.
No unbounded transfer URLs are minted.

Type the exact selected file name before deletion. The server checks the exact
path confirmation, the adapter uses nonrecursive deletion, and the editor refreshes
the directory before reporting that its page omits the file. A partial listing
does not establish a complete directory inventory. File contents and listings
stay in the mounted editor rather than new reactive storage tables.

Writes and deletes require a running machine with no unfinished component
operation, the original reviewed account, and an active approved run. Reads can
recover authorized home bytes after approval expiry or while the VM is stopped.
The shared client repeats binding and running/idle checks before dispatch and
after native replies. File actions do not reserve a lifecycle lease, so these
checks are not an atomic concurrency guarantee. Avoid concurrent lifecycle work
from another client while editing. A failed or
partial write/delete may have changed the guest; the error retains its operation
ID and path. Inspect that exact path before another change. Refresh and read
never replay mutations. Files render as plain text.

Home bytes survive a captured stop. `/tmp` is excluded from Boat snapshots and
must not be used for persistence evidence. Deterministic tests cover binary and
UTF-8 round trips, policy/byte refusal, nonrecursive delete and unknown replies.
Browser fixtures label their synthetic files and exercise the production panel;
they are not live provider qualification.

Local development stays on isolated anonymous worktree backends. Hosted setup
must verify the actual FantasticDev team slug/ID, reuse the correct existing
project and verify the selected deployment. This guide authorizes no hosted
production deployment or Boat provisioning.
