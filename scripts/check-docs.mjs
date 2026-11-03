import { mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export async function collectSamples() {
  const samples = [];
  for (const file of ["quickstart.md", "adapters.md"]) {
    const text = await readFile(path.join(root, "docs", file), "utf8");
    for (const match of text.matchAll(
      /^```(ts|tsx) ([^\n]+)\n([\s\S]*?)^```$/gm,
    )) {
      const location = match[2];
      if (!/^(convex|src)\/[a-zA-Z0-9_.-]+\.tsx?$/.test(location))
        throw new Error("Invalid documentation sample location");
      samples.push({
        name: `${file}-${samples.length}`,
        location,
        source: match[3],
      });
    }
    const typedFences = [...text.matchAll(/^```tsx?(?:\s|$)/gm)].length;
    if (
      samples.filter((sample) => sample.name.startsWith(file)).length !==
      typedFences
    )
      throw new Error(
        `Every TypeScript fence in ${file} needs a checked location`,
      );
  }
  return samples;
}
export async function checkSamples(samples) {
  if (!samples.length) throw new Error("No documentation samples");
  const temporary = await mkdtemp(path.join(tmpdir(), "sandbox-docs-"));
  try {
    // Resolve only public package exports from the example's installed dependencies.
    // Generated app imports are rebased to their actual checked-in host bindings.
    await symlink(
      path.join(root, "example/node_modules"),
      path.join(temporary, "node_modules"),
      "dir",
    );
    const files = [];
    for (const [index, sample] of samples.entries()) {
      const base = path.dirname(path.join(root, "example", sample.location));
      const source = sample.source.replace(
        /((?:from\s+|import\s*)["'])(\.[^"']+)(["'])/g,
        (_, prefix, relative, suffix) => {
          const target = path.resolve(base, relative);
          if (!target.startsWith(root + path.sep))
            throw new Error("Documentation import escapes repository");
          return prefix + target + suffix;
        },
      );
      const name = `${index}${path.extname(sample.location)}`;
      await writeFile(path.join(temporary, name), source);
      files.push(name);
    }
    await writeFile(
      path.join(temporary, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM"],
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          jsx: "react-jsx",
          types: ["node"],
          typeRoots: [
            path.join(root, "node_modules/@types"),
            path.join(root, "example/node_modules/@types"),
          ],
        },
        files,
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/typescript/bin/tsc"),
        "-p",
        path.join(temporary, "tsconfig.json"),
      ],
      { cwd: temporary, encoding: "utf8", timeout: 60000 },
    );
    return {
      status: result.status,
      output: (result.stdout ?? "") + (result.stderr ?? ""),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
