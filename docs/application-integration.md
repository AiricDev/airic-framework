# Application and Module integration

Start with [the Agent–Business State boundary](./agent-business-state-boundary.md). The business application owns authoritative state, its deterministic Cognitive Interface and the Capability API; Airic owns Work, Action, context delivery and trace.

An Airic Application selects and composes Modules. A Module is the source-ownership unit for one modification closure and may contain Domain code, use cases, Operating WorkTypes, Experience contributions, infrastructure and tests.

`module.yml` declares identity, Domain imports/exports, WorkType package paths and optional server/browser contribution entrypoints. The Application loads modules in dependency order. Missing dependencies, cycles, duplicate identities, incompatible releases and route conflicts fail at startup.

Keep Domain and Application code free of Airic, HTTP, React, Node and persistence mechanisms. Expose Agent operations through a module `DomainProvider`:

- trusted actor, WorkType and command identity come from `TrustedCallContext`, never tool input;
- commands atomically persist business effect, audit and stable receipt;
- `inspectCommand` reconciles ambiguous delivery without redispatch;
- release, build ID and reviewed source digest are pinned by each Work.

Cross-module code imports only the provider's `public/` contracts. The consumer owns a port, and Application composition injects the provider's public service. Mutable aggregates, transactions and repositories remain inside the owner module. Imports make a capability available but never grant Agent authority; actual tools are the intersection of module exports/imports, WorkType allowlist and host authorization.

`module.yml` discovers WorkType locations, but Runtime reads their content only through `OperatingModelRuntimePort`. On first setup the host explicitly imports a package as an immutable baseline; later working-tree edits require a governed proposal. Runtime pins the active revision for a complete turn, then resolves active again for the next turn. The same repository adapter may expose `OperatingModelLearningPort` to Reflection and `OperatingModelGovernancePort` to the human UI; neither Agent Runtime nor Reflection receives review/adopt authority. The Application host mounts module business routes under `/api/app`, Airic under `/api/airic`, static assets and then structured 404. Browser contributions provide navigation, routes, result views and Work starters without editing global route tables.

The host must establish a trusted actor before exposing Work APIs. The same host-owned access policy gates HTTP, SSE, runtime capability calls and optional ACP WebSocket sessions. `Work.createdBy` is set from that actor at creation; records without a trusted creator are not implicitly claimed by a browser user. `@airic/acp` adds Agent interaction only, while each module's Application Services remain authoritative for business data, approvals and exports. See the [ACP browser contract](./acp-browser-contract.md).

## Work HTTP and real-time events

The host mounts the Airic HTTP API under its base path (default `/api/airic`). Every route requires the host's `authenticate` actor and its `authorize` policy; the host may audit sensitive trace reads through `onTraceRead`.

- `POST /works/{id}/messages` sends one turn synchronously and returns the final `{ text }`; it remains the canonical send path.
- `GET /works/{id}/activity` reports the in-flight turn as `{ active, startedAt? }`.
- A Work cannot be completed while its turn is active; completion returns the same `WorkBusy` conflict used for a concurrent prompt.
- `GET /works/{id}/events` is a per-Work Server-Sent Events stream. It authenticates and audits the read, replays the Work's persistent trace (resuming after `?lastEventId=<eventId>` or `Last-Event-ID`), emits an `event: activity` snapshot, then streams further updates. Every delivered event is re-authenticated and re-authorized, and a revoked Work ends the stream (fail closed). Frame channels: `event: trace` (`id:` is the trace `eventId`, `data:` is the `TraceEvent`), `event: live` (transient `{ workId, type: "text-delta", text }` deltas) and `event: activity`.
- `GET /events` remains the host-wide stream and filters to the Works the actor may read.

The runtime records explicit turn lifecycle events `turn.started`, `turn.completed` and `turn.failed` in the persistent trace, and exposes transient text deltas through `subscribeLive`. Canonical history is always the trace; live deltas are display-only.

Because `EventSource` cannot send an `Authorization` header, a browser client consumes `/works/{id}/events` with a bearer-authenticated `fetch` and a streaming reader, then parses the SSE frames itself.

Use the version-matched [development skill](../skills/airic-app-development/SKILL.md) before changing an application boundary.
