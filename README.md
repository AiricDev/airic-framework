# Airic Framework

Airic connects document-defined operating models to deterministic domain capabilities. The Agent decides how to pursue a Work; application domain code decides which state changes are legal.

The framework deliberately owns only `Work` and cross-domain `Action` runtime entities. Sessions, turns, approvals, internal steps, and compaction belong to the harness and appear only as attributable trace when they matter. Project-owned Operating Models live only in `work-definitions/`; Git owns their history while Airic records the exact content delivered on each turn.

## Run the canonical demo

```sh
pnpm install
pnpm run build
pnpm --filter @airic/template-default dev
```

Open `http://127.0.0.1:4173`. The default is a clearly labelled simulated harness. See [the demo guide](./docs/demo.md) for the rejection/recovery path and real Pi configuration.

Git is required by `create-airic`. A generated project is initialized on `main` with one scaffold commit and includes Domain Model Smith, Operating Model Smith and Experience Smith onboarding Work Definitions. The generated application hosts one Node HTTP server: its business API under `/api/app/**`, the Airic handler under `/api/airic/**`, then production static assets. Configure the Pi harness to let each Work type modify only its granted project paths.

## Packages

- `@airic/framework`: Work, Action, domain integration contracts, context assembly, trace, runtime.
- `@airic/storage-files`: immutable journal, content objects, exclusive writer, verification and backup.
- `@airic/harness-pi`: Pi 0.80.10 adapter; Pi session/provider types remain private.
- `@airic/server`: mountable HTTP handler with resumable SSE and a static asset handler.
- `@airic/client`: typed browser SDK over the Airic HTTP API with reconnecting trace subscription.
- `@airic/ui`: extensible React workbench with provider and hooks.
- `create-airic`: generator built from the canonical default template.
- `@airic/testing`: provider-neutral fakes and fixtures.

Read [the integration guide](./docs/application-integration.md), [the implementation ledger](./docs/development-plan.md), [the sanitized live-provider acceptance](./docs/live-provider-acceptance.md), and [the v0.3 design](./docs/airic-framework-technical-design.md).
