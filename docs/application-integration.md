# Application and Module integration

An Airic Application selects and composes Modules. A Module is the source-ownership unit for one modification closure and may contain Domain code, use cases, Operating WorkTypes, Experience contributions, infrastructure and tests.

`module.yml` declares identity, Domain imports/exports, WorkType package paths and optional server/browser contribution entrypoints. The Application loads modules in dependency order. Missing dependencies, cycles, duplicate identities, incompatible releases and route conflicts fail at startup.

Keep Domain and Application code free of Airic, HTTP, React, Node and persistence mechanisms. Expose Agent operations through a module `DomainProvider`:

- trusted actor, WorkType and command identity come from `TrustedCallContext`, never tool input;
- commands atomically persist business effect, audit and stable receipt;
- `inspectCommand` reconciles ambiguous delivery without redispatch;
- release, build ID and reviewed source digest are pinned by each Work.

Cross-module code imports only the provider's `public/` contracts. The consumer owns a port, and Application composition injects the provider's public service. Mutable aggregates, transactions and repositories remain inside the owner module. Imports make a capability available but never grant Agent authority; actual tools are the intersection of module exports/imports, WorkType allowlist and host authorization.

WorkTypes live in `src/modules/<id>/operating/<work-type>`. Operating content is reloaded before each model call. Executable code requires build/restart. The Application host mounts module business routes under `/api/app`, Airic under `/api/airic`, static assets and then structured 404. Browser contributions provide navigation, routes, result views and Work starters without editing global route tables.

The host must establish a trusted actor before exposing Work APIs. The same host-owned access policy gates HTTP, SSE, runtime capability calls and optional ACP WebSocket sessions. `Work.createdBy` is set from that actor at creation; records without a trusted creator are not implicitly claimed by a browser user. `@airic/acp` adds Agent interaction only, while each module's Application Services remain authoritative for business data, approvals and exports. See the [ACP browser contract](./acp-browser-contract.md).

Use the version-matched [development skill](../skills/airic-app-development/SKILL.md) before changing an application boundary.
