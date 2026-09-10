# Airic Framework Architecture Map

- Last updated: 2026-09-10
- Architectural decision owners: Airic maintainers

## Layer layout

| Layer | Location | Notes |
|---|---|---|
| Runtime policy | `packages/framework/src/application` | Work, completion, trace and capability orchestration |
| Integration contracts | `packages/framework/src/integration` | Harness and DomainModule contracts |
| Adapters | `packages/harness-pi`, `packages/storage-files` | Pi execution, controlled workspace and file persistence |
| Delivery | `packages/server`, `packages/client`, `packages/ui` | Mountable HTTP, browser SDK and generic workbench |
| Application template | `templates/default` | Example domain plus stable host and writable application assembly |
| Generator | `packages/create-airic` | Copies the template and initializes Git |

## Primary routes

| Capability | Owner | Entry point | Verification |
|---|---|---|---|
| Governed Work execution | Airic runtime | `packages/framework/src/application/runtime.ts` | `packages/framework/test/runtime.test.ts` |
| Smith workspace access | Pi adapter | `packages/harness-pi/src/workspace.ts` | `packages/harness-pi/test/workspace.test.ts` |
| Airic HTTP API | Server adapter | `packages/server/src/index.ts` | `packages/server/test/server.test.ts` |
| Browser projection | Client/UI adapters | `packages/client`, `packages/ui` | package tests and template Playwright tests |
| Application slice registration | Generated application | `src/integration/application.ts` | application, HTTP and browser tests |

## Placement rules

- Stable domain invariants stay in `src/domain`; use-case orchestration and its ports stay in `src/application`.
- Infrastructure implements application-owned ports and is created only by `src/integration/application.ts`.
- The application assembly constructs each Application Service once and shares it with HTTP routes and Airic DomainModules.
- `src/main.ts` and `src/client.tsx` are stable host roots; Smiths do not modify them.
- Workspace read and write authority is declared per Work Definition by the host; tool evidence is validated before completion.
- Dependency rules are enforced by `scripts/architecture-check.mjs` and the package test suites.

## Boundary debts

—

## Open ownership questions

- Domain-specific infrastructure remains host/developer-owned; Experience Smith may consume existing adapters but must hand off when a new persistence adapter is required.
