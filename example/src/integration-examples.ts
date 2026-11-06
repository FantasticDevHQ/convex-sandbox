import manifest from "../shared/integration-examples.json";
// Raw source imports are inert text. Never execute trusted host modules in the browser.
const sources = import.meta.glob<string>(
  [
    "../convex/live/files.ts",
    "../convex/live/lifecycle.ts",
    "../convex/live/logs.ts",
    "../convex/live/fork.ts",
    "../convex/live/catalog.ts",
    "../convex/convex.config.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);
export const integrationExamples = manifest.map((entry) => {
  const source = sources[`../${entry.sourcePath}`];
  if (!source) throw Error("A checked integration source is missing.");
  return { ...entry, source };
});
export function integrationExample(workflow: string) {
  return (
    integrationExamples.find((entry) => entry.id === workflow) ??
    integrationExamples[0]
  );
}
