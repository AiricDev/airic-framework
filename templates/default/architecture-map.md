# Architecture map

| Owner | Location | Responsibility |
|---|---|---|
| Application | `src/app`, `main.ts`, `client.tsx` | Composition, identity, host routes, navigation and lifecycle |
| Module | `src/modules/<id>` | One vertical modification closure |
| Public contract | `src/modules/<id>/public` | Stable cross-module types, schemas and references |
| Domain | `src/modules/<id>/domain` | Business state and invariants |
| Application use cases | `src/modules/<id>/application` | Authority, transactions, ports and orchestration |
| Operating Model | `src/modules/<id>/operating` | WorkType manifests and methods |
| Experience | `src/modules/<id>/experience` | HTTP routes, React pages and result views |
| Infrastructure | `src/modules/<id>/infrastructure` | Storage and external adapters |

Modules declare imports and contributions in `module.yml`. Cross-module code imports only `public/`; mutable aggregates remain owned by their provider module. Agent capabilities are the intersection of the WorkType allowlist, imported/exported Domain capabilities and host authorization.
