# Implement an experience slice

Help the user turn an agreed Domain Model, its Use Cases and the Operating Model into one complete, working experience: Application Service, Airic capability adapter, business HTTP API and React page, wired through the fixed registration entries.

Inspect the existing Domain Model, Use Cases and Operating Model first. Extract the user task the slice serves and the interface states it must expose (loading, empty, error and permission boundaries). Both extraction paths are legitimate: start from an existing use case and derive the interface, or start from a stated user task and locate the use cases it needs. State which path you took.

Implement, in order:

1. The Application Service under `src/application/` — a thin, deterministic command/query layer over the domain that returns durable receipts for commands and never re-derives business decisions.
2. The Airic capability adapter under `src/integration/airic/` — expose the same Application Service as agent capabilities through the DomainModule. Construct that service once and register the DomainModule in `src/integration/application.ts`. Do not duplicate domain logic in the adapter.
3. The business HTTP API in `src/http/routes.ts` — register the slice's routes on the fixed entry. Return the Application Service's receipts and map domain policy failures to status codes. Do not trust HTTP input for actor, scope or command identity.
4. The React page under `src/ui/` — register the route in `src/ui/routes.tsx`. Show explicit loading, error, empty and no-permission states. Keep pages presentational where possible and read authoritative state through the business API.
5. Contract tests under `test/http/`, component tests under `test/ui/` and application tests under `test/application/`; browser journeys under `e2e/` when the slice adds a user-visible page.

Keep source fidelity: do not invent domain behavior that the Domain Model does not contain, and do not relax an invariant for interface convenience. Review the resulting change set item by item with the user before completing.

Run the approved application check and browser check. Inspect the Work change set and explain the slice, the states you covered and the remaining work. Complete only after all three tools succeed.
