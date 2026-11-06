import { useRef, useState } from "react";
import type { FileList, FileRead } from "@fantastic.dev/convex-sandbox";
import {
  HOME_FILE_ROOT,
  HOME_FILE_BYTES,
  validHomeName,
} from "../shared/file-policy";
export type FileActions = {
  list: () => Promise<FileList>;
  read: (path: string) => Promise<FileRead>;
  write: (
    path: string,
    data: ArrayBuffer,
    operationId: string,
  ) => Promise<{ bytesWritten: number; partial: boolean }>;
  remove: (path: string, operationId: string) => Promise<{ deleted: boolean }>;
};
export function FilesPanel({
  machineKey,
  actions,
}: {
  machineKey: string;
  actions: FileActions;
}) {
  const [name, setName] = useState("example.txt"),
    [text, setText] = useState("hello sandbox\n"),
    [confirmation, setConfirmation] = useState("");
  const [directory, setDirectory] = useState<FileList | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState("");
  const busy = useRef(false);
  const path = `${HOME_FILE_ROOT}/${name}`,
    size = new TextEncoder().encode(text).byteLength;
  async function request(kind: "list" | "read" | "write" | "delete") {
    if (busy.current) return;
    const operationId = `file-${crypto.randomUUID()}`;
    busy.current = true;
    setPending(true);
    setMessage("");
    setFailed("");
    try {
      if (kind === "list") {
        setDirectory(await actions.list());
        setMessage("Directory refreshed.");
      }
      if (kind === "read") {
        const result = await actions.read(path);
        if (result.truncated) throw Error("Partial read");
        setText(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            result.data,
          ),
        );
        setMessage(`Read ${result.bytesRead} exact bytes from ${path}.`);
      }
      if (kind === "write") {
        const bytes = new TextEncoder().encode(text);
        const written = await actions.write(path, bytes.buffer, operationId);
        if (written.partial || written.bytesWritten !== bytes.length)
          throw Error("Partial write");
        const read = await actions.read(path),
          actual = new Uint8Array(read.data);
        if (
          read.truncated ||
          actual.length !== bytes.length ||
          !actual.every((byte, i) => byte === bytes[i])
        )
          throw Error("Readback mismatch");
        setDirectory(await actions.list());
        setMessage(
          `Saved and read back ${bytes.length} exact bytes from ${path}.`,
        );
      }
      if (kind === "delete") {
        if (confirmation !== name) throw Error("Confirmation changed");
        if (!(await actions.remove(path, operationId)).deleted)
          throw Error("Deletion not confirmed");
        const list = await actions.list();
        setDirectory(list);
        setConfirmation("");
        if (list.entries.some((entry) => entry.path === path))
          throw Error("Deleted path still listed");
        setMessage(`Deleted ${path}; refreshed list omits that file.`);
      }
    } catch {
      setFailed(
        `${kind} request ${operationId} at ${kind === "list" ? HOME_FILE_ROOT : path} was not fully confirmed. Inspect the exact path before another change. No automatic retry occurred. If the directory is missing, prepare demo in the approved guest. UTF-8 editing cannot open binary files.`,
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="files-workspace">
      <p className="lede">
        Bounded home files on <strong>{machineKey}</strong>. Native requests use
        the selected owned binding.
      </p>
      <dl className="setup-facts">
        <div>
          <dt>Authorized directory</dt>
          <dd>{HOME_FILE_ROOT}</dd>
        </div>
        <div>
          <dt>Inline limit</dt>
          <dd>64 KiB</dd>
        </div>
        <div>
          <dt>Transfer URLs</dt>
          <dd>Unsupported</dd>
        </div>
      </dl>
      <section className="setup-card">
        <h2>Directory</h2>
        <button
          type="button"
          disabled={pending}
          onClick={() => void request("list")}
        >
          {pending ? "Working…" : "Refresh directory"}
        </button>
        {directory === null ? (
          <p>Refresh to read the authorized directory. No account scan.</p>
        ) : (
          <>
            {directory.entries.length === 0 && (
              <p>No allowed files in this page.</p>
            )}
            <ul className="home-file-list">
              {directory.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setName(entry.name);
                      setText("");
                      setConfirmation("");
                      setMessage("");
                    }}
                  >
                    {entry.name}
                  </button>
                  <span>{entry.sizeBytes ?? "Unknown"} bytes</span>
                </li>
              ))}
            </ul>
            {directory.partial && (
              <p role="status">
                Partial directory listing. At most 50 entries are returned;
                filtered names, symlinks and subdirectories are omitted. Native
                pagination is unsupported.
              </p>
            )}
          </>
        )}
      </section>
      <section className="setup-card">
        <h2>UTF-8 file editor</h2>
        <label className="command-field">
          File name
          <input
            value={name}
            disabled={pending}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              setConfirmation("");
              setMessage("");
            }}
          />
        </label>
        <p>
          Direct files only: letters, digits, dot, underscore and hyphen. The
          name must start with a letter or digit.
        </p>
        <label className="command-field">
          File contents
          <textarea
            value={text}
            disabled={pending}
            rows={8}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <p data-testid="file-byte-count">
          {size} / {HOME_FILE_BYTES} UTF-8 bytes
        </p>
        {size > HOME_FILE_BYTES && (
          <p role="alert">This file exceeds 64 KiB. No write can start.</p>
        )}
        <div className="file-actions">
          <button
            type="button"
            disabled={pending || !validHomeName(name)}
            onClick={() => void request("read")}
          >
            Read selected file
          </button>
          <button
            type="button"
            disabled={pending || !validHomeName(name) || size > HOME_FILE_BYTES}
            onClick={() => void request("write")}
          >
            Save and verify bytes
          </button>
        </div>
        <label className="command-field">
          Type the exact file name to delete
          <input
            value={confirmation}
            disabled={pending}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        <button
          className="destructive-button"
          type="button"
          disabled={pending || !validHomeName(name) || confirmation !== name}
          onClick={() => void request("delete")}
        >
          Delete selected file
        </button>
        <p>
          Deletion is nonrecursive. Unknown writes or deletes must be inspected
          at their original path; refresh never replays them.
        </p>
      </section>
      {message && (
        <p role="status" data-testid="file-result">
          {message}
        </p>
      )}
      {failed && <p role="alert">{failed}</p>}
      <section className="setup-card">
        <h2>Scope and persistence</h2>
        <p>
          This is a lexical path policy, not a symlink jail. Use a trusted guest
          directory; a guest-created symlink can redirect file access. Mutations
          need a running fixture and an active approved run.
        </p>
        <p>
          Prepare the demo directory through an approved command if it does not
          exist. Home bytes survive a captured stop; /tmp is not a persistence
          fixture.
        </p>
      </section>
    </div>
  );
}
