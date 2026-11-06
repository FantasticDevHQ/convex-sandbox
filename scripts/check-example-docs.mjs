import { readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
export async function collectDisplayedSamples() {
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "example/shared/integration-examples.json"),
      "utf8",
    ),
  );
  const view = await readFile(
    path.join(root, "example/src/integration-examples.ts"),
    "utf8",
  );
  const ids = new Set(),
    locations = new Set(),
    samples = [];
  for (const entry of manifest) {
    if (
      ids.has(entry.id) ||
      locations.has(entry.sourcePath) ||
      !/^convex\/(?:live\/[a-zA-Z]+|convex\.config)\.ts$/.test(entry.sourcePath)
    )
      throw Error("Invalid or duplicate displayed sample");
    ids.add(entry.id);
    locations.add(entry.sourcePath);
    if (!view.includes(JSON.stringify(`../${entry.sourcePath}`)))
      throw Error("Displayed source is absent from the inert raw imports");
    const source = await readFile(
      path.join(root, "example", entry.sourcePath),
      "utf8",
    );
    samples.push({
      name: `example/${entry.id}`,
      location: entry.sourcePath,
      source,
    });
  }
  const imports = [...view.matchAll(/"\.\.\/(convex\/[^"\n]+\.ts)"/g)].map(
    (match) => match[1],
  );
  if (
    imports.length !== samples.length ||
    imports.some((location) => !locations.has(location))
  )
    throw Error(
      "Every displayed raw import must have a checked manifest entry",
    );
  return samples;
}
/** Inspect repository-owned source only. Never load environment values or execute host modules. */
export function assertNoCredentialValues(source) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:sk_live_|sk_test_|pk_live_|ghp_|gho_|github_pat_|xox[baprs]-)[a-zA-Z0-9_-]{8,}/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/,
  ];
  if (patterns.some((pattern) => pattern.test(source)))
    throw Error("Credential-shaped value in displayed source");
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    const module = match[1];
    if (
      module.startsWith("@fantastic.dev/convex-sandbox") &&
      !new Set([
        "@fantastic.dev/convex-sandbox",
        "@fantastic.dev/convex-sandbox/server",
        "@fantastic.dev/convex-sandbox/boat",
        "@fantastic.dev/convex-sandbox/convex.config.js",
      ]).has(module)
    )
      throw Error("Sample bypasses public package exports");
    if (module === "@boatdev/sdk")
      throw Error("Displayed consumers must use the shared client");
  }
  // This is a static regression guard, supplemented by source review. It does not read secrets.
  for (const match of source.matchAll(
    /\b(?:apiKey|secret|password|token|credential|privateKey|authorization)\b["']?\s*(?:=|:)\s*(["'`])([^"'`\n]*)\1/gi,
  )) {
    const value = match[2];
    if (value && !/^(?:Bearer )?<[^>\n]+>$/.test(value))
      throw Error("Hardcoded credential value in displayed source");
  }
}
