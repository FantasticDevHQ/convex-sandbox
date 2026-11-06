import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FilesPanel, type FileActions } from "../../src/files-panel";
import "../../src/style.css";
function Fixture() {
  const disk = useRef(new Map<string, ArrayBuffer>()),
    [writes, setWrites] = useState(0);
  const actions: FileActions = {
    list: async () => ({
      entries: [...disk.current].map(([path, data]) => ({
        name: path.split("/").at(-1) ?? "",
        path,
        kind: "file",
        sizeBytes: data.byteLength,
      })),
      nextCursor: null,
      partial: false,
    }),
    read: async (path) => {
      const data = disk.current.get(path);
      if (!data) throw Error("Synthetic missing file");
      return {
        data,
        offset: 0,
        bytesRead: data.byteLength,
        totalBytes: data.byteLength,
        truncated: false,
        nextOffset: null,
      };
    },
    write: async (path, data) => {
      setWrites((n) => n + 1);
      if (location.search.includes("fail")) throw Error("Synthetic lost reply");
      disk.current.set(path, data.slice(0));
      return { bytesWritten: data.byteLength, partial: false };
    },
    remove: async (path) => ({ deleted: disk.current.delete(path) }),
  };
  return (
    <main className="workbench workflow-page">
      <p>
        Offline UI test. Synthetic directory and bytes; no Boat calls or actual
        guest files.
      </p>
      <h1>Files</h1>
      <p>
        Synthetic write callbacks:{" "}
        <output data-testid="file-write-count">{writes}</output>
      </p>
      <FilesPanel machineKey="research-one" actions={actions} />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<Fixture />);
