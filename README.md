# Airic Framework

Airic connects document-defined operating models to deterministic domain capabilities. The Agent decides how to pursue a Work; application domain code decides which state changes are legal.

The framework deliberately owns only `Work` and cross-domain `Action` runtime entities. Applications compose Modules; each Module may own Domain providers, WorkTypes and server/browser contributions. Sessions, turns, approvals, internal steps, and compaction belong to the harness and appear only as attributable trace when they matter. A WorkType's Operating Model lives beside its vertical slice under `src/modules/<module>/operating/`; Git owns history while Airic records the exact content delivered on each turn.

## Run the canonical demo

```sh
pnpm install
pnpm run build
pnpm --filter @airic/template-default dev
```

Open `http://127.0.0.1:4173`. The default is a clearly labelled simulated harness. See [the demo guide](./docs/demo.md) for the rejection/recovery path and real Pi configuration.

Git is required by `create-airic`. A generated project is initialized on `main` with one scaffold commit and includes a `development/module-smith` onboarding WorkType. The generated application hosts one Node HTTP server: module business routes under `/api/app/**`, the Airic handler under `/api/airic/**`, then production static assets. Configure the Pi harness to let Module Smith modify only its explicitly selected target module.

## Packages

- `@airic/framework`: Work, Action, domain integration contracts, context assembly, trace, runtime.
- `@airic/storage-files`: immutable journal, content objects, exclusive writer, verification and backup.
- `@airic/harness-pi`: Pi 0.80.10 adapter; Pi session/provider types remain private.
- `@airic/server`: mountable HTTP handler with resumable SSE and a static asset handler.
- `@airic/acp`: optional, Work-bound ACP WebSocket gateway for browser Agent panels; it projects Airic trace and never owns business state.
- `@airic/client`: typed browser SDK over the Airic HTTP API with reconnecting trace subscription.
- `@airic/ui`: extensible React workbench with provider and hooks.
- `create-airic`: generator built from the canonical default template.
- `@airic/testing`: provider-neutral fakes and fixtures.

Read [the integration guide](./docs/application-integration.md), [the ACP browser contract](./docs/acp-browser-contract.md), [the implementation ledger](./docs/development-plan.md), [the sanitized live-provider acceptance](./docs/live-provider-acceptance.md), and [the pre-0.2 historical design](./docs/airic-framework-technical-design.md).
