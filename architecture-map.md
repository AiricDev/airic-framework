# Airic Framework Architecture Map

- Last updated: 2026-09-12
- Architectural decision owners: Airic maintainers

## Ownership

| Layer | Location | Owns |
|---|---|---|
| Framework core | `packages/framework` | Work/Action lifecycle, module and WorkType resolution, context, capability mediation and canonical trace |
| Storage | `packages/storage-files` | Runtime journal, trace evidence and module package loading |
| Agent harness | `packages/harness-pi` | Pi execution, model sessions and controlled workspace tools |
| HTTP delivery | `packages/server` | Host-mounted Airic HTTP/SSE API with a trusted actor and host access policy |
| ACP delivery | `packages/acp` | Optional, Work-bound same-origin WebSocket projection of Agent interaction |
| Browser delivery | `packages/client`, `packages/ui` | Typed HTTP client and optional generic Workbench |
| Application | Generated `src/app`, `src/main.ts`, `src/client.tsx` | Identity, access policy, module assembly, business routes, navigation and one server |
| Module | Generated `src/modules/<id>` | Vertical-slice Domain, use cases, Operating WorkTypes, Experience and adapters |

## Critical paths

| Behavior | Owner | Verification |
|---|---|---|
| Work creator, authority and per-turn serialization | `packages/framework/src/application/runtime.ts` | `packages/framework/test/runtime.test.ts` |
| HTTP/SSE filtering and access checks | `packages/server/src/index.ts` | `packages/server/test/server.test.ts` |
| ACP bind, prompt, cancel, replay | `packages/acp/src/index.ts` | `packages/acp/test/gateway.test.ts` |
| Module dependency and public contract resolution | `packages/framework/src/application` | module registry tests |
| Workspace scope and secret protection | `packages/harness-pi/src/workspace.ts` | workspace tests |
| Generated standalone app | `templates/default`, `packages/create-airic` | `scripts/verify-packed-app.mjs` |

## Boundary rules

- Framework core imports neither HTTP, React, ACP nor a business domain.
- The Application host selects modules and binds a trusted actor and authorization policy; HTTP, SSE, ACP and runtime capability execution check that policy. WorkType imports do not grant user permission.
- A WorkType's Operating Model is reloaded on the next turn; Domain release/build/source bindings remain pinned. Airic trace records what was delivered and done.
- Module Domain and Application policy remain independent of Airic, HTTP, React and persistence. Cross-module consumers use public contracts and owner-provided services, not repositories or deep imports.
- ACP is an interaction projection. Business data, command receipts, review, approval and export remain owned by module Application Services and their repositories.
- Module Smith writes only its host-scoped target module. The host owns fixed checks; the Agent cannot use a general shell or Git write tools.
- `scripts/architecture-check.mjs` and package tests enforce these boundaries.
