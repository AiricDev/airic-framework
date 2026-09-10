# Experience Smith boundaries

Experience code owns how the application is used, never what it means. Keep domain meaning in `src/domain/` and business invariants executable there.

This Work may create or change only:

- `src/application/**` — Application Services and use-case orchestration
- `src/http/**` — business HTTP API and routing registrations
- `src/integration/**` — Airic capability adapters over Application Services
- `src/ui/**` — React pages, components, result views and API clients
- `test/application/**`, `test/http/**`, `test/ui/**` — slice tests
- `e2e/**` — browser journeys

It must not write `src/domain/**`, `test/domain/**`, `src/infrastructure/**`, `work-definitions/**`, secrets (`.env`, `models.json`, `models-store.json`), Git metadata, or the stable roots `src/main.ts` and `src/client.tsx`. Construct shared Application Services and register DomainModules through `src/integration/application.ts`, register HTTP routes through `src/http/routes.ts`, and register pages through `src/ui/routes.tsx`. If the outcome requires domain or infrastructure changes, or a new Work Definition, finish the slice boundary and hand off explicitly.

Result values store business references (for example `{ type: "case", id }`), never copies of business state; the business API and its repository remain the authoritative source. Do not read secrets. Do not perform Git writes. Concurrency, path escapes and secret reads are governed by the existing workspace protections.
