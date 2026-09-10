# Airic Application Architecture Map

- Last updated: 2026-09-10
- Architectural decision owners: application maintainers

## Layer layout

| Layer | Location | Notes |
|---|---|---|
| Domain | `src/domain` | Stable business language and invariants |
| Application | `src/application` | Use cases and client-authored ports |
| Infrastructure | `src/infrastructure` | Adapters implementing application ports |
| Application assembly | `src/integration/application.ts` | Constructs shared services and registers HTTP routes and DomainModules |
| Airic integration | `src/integration/airic` | DomainModule capability adapters and harness integration |
| Delivery | `src/http`, `src/ui` | Business HTTP API and React experience |
| Stable roots | `src/main.ts`, `src/client.tsx` | Server and browser host wiring; Smiths do not edit these files |

## Use case catalog

| Use case | Location | Port / adapter |
|---|---|---|
| Read and update Case | `src/application/case-service.ts` | `CaseRepository` / `JsonCaseRepository` |

## Placement rules

- Add domain behavior under `src/domain` and focused domain tests under `test/domain`.
- Add use cases and their ports under `src/application`; implement ports under `src/infrastructure`.
- Construct each service once in `src/integration/application.ts`; pass it to both `src/http/routes.ts` and DomainModules under `src/integration/airic`.
- Register browser routes in `src/ui/routes.tsx` and reference-based result views under `src/ui/result-views`.
- Work methods live only in `work-definitions`.

## Boundary debts and open ownership questions

—
