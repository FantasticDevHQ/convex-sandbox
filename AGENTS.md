# Agent instructions

- This repository is public. Never commit credentials, local environments, customer data or private conversations.
- Keep the core provider-neutral. Provider adapters, external storage and custom guest desktop/runtime work have separate projects.
- Use the shared PR standard in docs/pull-request-standard.md. Include ticket linkage and reviewer-accessible evidence. Evidence is not source documentation.
- Use UbiCloud for all CI compute. Never substitute GitHub-hosted runner labels.
- Run focused checks with one worker and a bounded heap on shared hosts. Run full check:all on UbiCloud. Serialize heavy jobs using the shared host lock.
- Local Convex development uses scripts/worktree lifecycle commands with anonymous, checkout-local backends. Do not copy production credentials or kill processes by port/name.
- Keep provider APIs in trusted actions and serializable component state behind validators. Authenticate and authorize in application wrappers.
- Do not publish a package or claim provider support until its release/integration checks are complete.
