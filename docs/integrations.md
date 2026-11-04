# Integration roadmap

The baseline wraps sandbox APIs behind common typed contracts. It does not choose a consumer's account, bot, conversation or desktop topology. Boat, E2B and Daytona are separate planned provider integration projects; this page links their public starting points without claiming that an adapter exists here.

## Boat

The [transport decision and capability audit](boat/decision.md) selects the official
SDK's low-level API with injected fetch, subject to an anonymous Convex runtime
gate. An [experimental server-only entry](boat/setup.md) implements `create` and
`describe` through shared claims; other operations and live qualification remain pending.

Wrap existing Boat APIs and audit its existing Convex component before designing replacements:

- [Convex component directory](https://www.convex.dev/components/boatdev/convex)
- [Upstream boat-convex source](https://github.com/ariana-dot-dev/boat-convex)
- Upstream package: `@boatdev/convex`

Native snapshots, runtimes and persistence must be evaluated in that integration. A provider's agent feature is not automatically a suitable host agent harness.

## E2B

Wrap E2B's native SDK/component behind the same registration and conformance boundary:

- [Convex component directory](https://www.convex.dev/components/e2b/convex)
- [Upstream e2b-convex source](https://github.com/e2b-dev/e2b-convex)
- Upstream package: `@e2b/convex`

The integration must report actual lifecycle, retention, command and image behavior rather than assuming it matches another provider.

## Daytona

Wrap Daytona's existing APIs/component and preserve provider-native job/resource identities:

- [Convex component directory](https://www.convex.dev/components/daytona/convex)
- [Upstream Convex integration source](https://github.com/daytona/integrations/tree/main/packages/convex)
- Upstream package: `@daytona/convex`

Live support, supported connection kinds and disposable cleanup need their own provider-specific verification.

## Durable user data outside the base image

This separate storage project addresses durable file identity and isolation across machine/template replacement. An R2 or other object-storage adapter is not installed by the baseline. File CRUD and native disk snapshots alone do not establish per-user storage isolation, external bucket mounting or data migration across image updates. Storage ownership, credentials and recovery policies belong to the chosen integration and host.

## Desktop and agent runtime work

Custom guest images, backgrounds, Unix users, browser profiles, desktop sessions/streams, agent harnesses and protected runtimes are outside this component's baseline. A host may build these on provider APIs after validating the required isolation and access behavior. The abstraction neither requires shared machines nor promises separate desktops. No consumer branding, billing model or agent orchestration is imposed here.

## Enabling a future live example

Follow the [adapter guide](adapters.md), reuse existing upstream capabilities and run conformance plus explicitly opted-in live resource checks. Configure credentials and selection on the server, authenticate/authorize the host wrappers, advertise tested capabilities, and own cleanup of every disposable test resource, including unknown outcomes. Add a live UI option only after that path works; the current [playground](example-backend.md) remains simulated.
