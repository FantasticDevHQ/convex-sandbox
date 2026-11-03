# Baseline release candidate

`0.1.0-rc.0` is prepared candidate metadata, not an npm publication. The package
remains `private: true`. The npm name's availability, organization permissions and
trusted-publisher configuration are unverified. No registry credentials or
publishing permissions are changed by this workflow.

The [changelog](../CHANGELOG.md) states the pre-1.0 guarantees and exclusions. The
included adapter and playground are simulated; Boat, E2B and Daytona remain
separate integrations. A candidate does not certify live providers, VM isolation,
exactly-once effects, image portability or a retention SLA.

## Prepare a local artifact

From a clean committed checkout after the required checks:

```sh
pnpm release:candidate /tmp/convex-sandbox-candidate-unique
```

Choose a new absolute output directory outside the checkout. The command builds
the library, packs the artifact, validates its allowlist and writes `candidate.json`
and `SHA256SUMS`. It refuses existing destinations and dirty source. On failure
it removes only the output directory it created. The metadata records source
commit, lockfile digest and tarball digest/size without local paths or credentials.
It is unsigned and does not claim tests passed or that registry publishing occurred.
Keep artifacts outside source control.

The allowlist permits compiled JavaScript/declarations, Markdown guides, package
metadata/license/changelog and the unchanged official logo. It rejects source
files, local state, environment files, source maps and evidence media. This is a
file-layout gate, not a general secret detector; public source/diff review still
applies.

## Manual UbiCloud candidate workflow

After the workflow is merged, dispatch `Release candidate` from the repository's
live default branch. Other branch runs are skipped. The read-only build job runs
frozen installation and full `pnpm check:all`, then uploads the candidate tarball,
metadata and checksum file. The real two-backend qualification mounts the tarball
in the first owned host and uses the workspace package in the sibling, checking
actual component installation, simulation, browser state and restart recovery.

A separate UbiCloud job downloads only those artifacts and invokes GitHub's
pinned official [attestation action](https://github.com/actions/attest). It has
short-lived OIDC and attestation permissions, executes no checkout/repository
scripts, and binds the tarball and metadata to workflow provenance. It does not
push to a package/container registry. Both jobs must succeed before describing
the candidate as attested. Inspect their actual runner IDs/names and labels.
GitHub attestation support is required; failures remain failures, never an unsigned
success claim. A local candidate does not have this workflow signature.

Download `baseline-candidate` from that run, then verify its content and provenance:

```sh
sha256sum -c SHA256SUMS
gh attestation verify fantastic.dev-convex-sandbox-0.1.0-rc.0.tgz --repo FantasticDevHQ/convex-sandbox
gh attestation verify candidate.json --repo FantasticDevHQ/convex-sandbox
```

The tarball consumer checks public exports without mandatory React/provider SDKs
or convex-test runtime, while the anonymous host proves the packed component
mounts and runs. TypeScript/codegen checks include declaration and generated API
compatibility. The example remains a local fixture, not production authentication.

## Publishing remains a separate owner decision

Before an actual registry release, the owner must approve the exact version and
artifact, verify package-name/scope ownership, choose/configure trusted publishing
and review the release notes and provenance. Any removal of `private: true`, npm
publication, release tag or registry credential change requires that separate
approved release work. There is no publish command, npm token, automatic tag push
or GitHub release creation in this candidate workflow. Do not infer registry
availability from the package name or a successful tarball build.
