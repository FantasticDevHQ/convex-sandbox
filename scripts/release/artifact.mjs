export function validateArtifactPaths(entries) {
  if (!entries.length) throw new Error("Empty package archive");
  for (const file of entries) {
    const parts = file.split("/");
    if (
      parts.some(
        (part) => !part || part.startsWith(".") || part === "node_modules",
      ) ||
      file.includes("\\") ||
      !/^package\/(?:dist\/[a-zA-Z0-9_./-]+\.(?:js|d\.ts)|docs\/[a-zA-Z0-9_./-]+\.md|assets\/brand\/logo-mark\.svg|package\.json|README\.md|CHANGELOG\.md|LICENSE)$/.test(
        file,
      )
    )
      throw new Error(`Unexpected package entry: ${file}`);
  }
}
export function candidateMetadata(manifest, artifact) {
  if (
    manifest.private !== true ||
    !/^0\.\d+\.\d+-rc\.\d+$/.test(manifest.version) ||
    typeof manifest.name !== "string"
  )
    throw new Error("Candidate requires private pre-1.0 rc metadata");
  if (
    !/^[a-f0-9]{40}$/.test(artifact.sourceCommit) ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
    !/^[a-f0-9]{64}$/.test(artifact.lockfileSha256) ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 1 ||
    !/^[a-zA-Z0-9_.-]+\.tgz$/.test(artifact.file)
  )
    throw new Error("Invalid candidate identity");
  return {
    schemaVersion: 1,
    name: manifest.name,
    version: manifest.version,
    sourceCommit: artifact.sourceCommit,
    lockfileSha256: artifact.lockfileSha256,
    artifact: {
      file: artifact.file,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    },
    registry: { published: false, availability: "unverified" },
    provenance: "unsigned metadata; verify workflow attestation separately",
  };
}
