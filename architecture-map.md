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
| Sensitive trace read audit hook and Reflection candidate evidence retrieval | `packages/server/src/index.ts`, `packages/framework/src/application/runtime.ts` | server and runtime tests |
| Host-extracted Work evidence, bounded binary upload and on-demand Agent reading | `packages/framework/src/application/runtime.ts`, `packages/server/src/index.ts`, `packages/client/src/index.ts` | runtime, server and client tests |
| ACP bind, prompt, cancel, replay | `packages/acp/src/index.ts` | `packages/acp/test/gateway.test.ts` |
| Module dependency and public contract resolution | `packages/framework/src/application` | module registry tests |
| Remote business-system integration | `packages/framework/src/integration/http-domain.ts` | `packages/framework/test/http-domain.test.ts` |
| Review-to-adoption Operating Model seam | `packages/framework/src/application/ports.ts`, `packages/framework/src/application/runtime.ts` | `packages/framework/test/runtime.test.ts` |
| Workspace scope and secret protection | `packages/harness-pi/src/workspace.ts` | workspace tests |
| Generated standalone app | `templates/default`, `packages/create-airic` | `scripts/verify-packed-app.mjs` |

## Boundary rules

- Framework core imports neither HTTP, React, ACP nor a business domain.
- The Application host selects modules and binds a trusted actor and authorization policy; HTTP, SSE, ACP and runtime capability execution check that policy. WorkType imports do not grant user permission.
- `onTraceRead` hooks let an Application fail closed and durably audit access to sensitive Work traces, including HTTP/SSE and Agent trace retrieval; Framework does not define business-specific trace roles.
- A WorkType's Operating Model is reloaded on the next turn; Domain release/build/source bindings remain pinned. Airic trace records what was delivered and done.
- Module Domain and Application policy remain independent of Airic, HTTP, React and persistence. Cross-module consumers use public contracts and owner-provided services, not repositories or deep imports.
- ACP is an interaction projection. Business data, command receipts, review, approval and export remain owned by module Application Services and their repositories.
- `createHttpDomainProvider` adapts the `airic-domain/v1` protocol to the existing inward `DomainProvider` port. Its host-owned `requestHeaders` signs serialized transport requests only; it carries Work/Action correlation and expected releases, but never makes tool-input identity authoritative. Network loss, timeout and unparseable replies are `unknown` and require inspection/reconciliation.
- `TurnContextRef` is traceable UI navigation context. It reaches the ContextEnvelope as a non-authoritative hint; it cannot change the Work target, identity or authorization.
- Business systems own Business State, deterministic Cognitive Interfaces and typed Capability APIs. Airic owns Work/Action/trace and never turns a projection into authoritative business data; see `docs/agent-business-state-boundary.md`.
- Reflection is advisory. `OperatingModelChangePort` is the only optional adoption seam and records `reflection.adopted` only after a host adapter supplies an actual applied reference and validation evidence. There is intentionally no default adapter or Operating Model asset lifecycle in Framework.
- The Application host owns document extraction via `RuntimeOptions.extractEvidence`; Airic stores the original and text projection as Work-bound evidence and limits Agent reads to a locator on the same Work. This is not a business attachment or approval.
- Module Smith writes only its host-scoped target module. The host owns fixed checks; the Agent cannot use a general shell or Git write tools.
- `scripts/architecture-check.mjs` and package tests enforce these boundaries.
