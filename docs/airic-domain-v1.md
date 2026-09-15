# Airic Domain HTTP Protocol v1

`airic-domain/v1` connects an Airic runtime to a deterministic business
system without importing the runtime, Node.js, or Agent SDK types into that
system. Authentication is owned by the business-system adapter; an `actor`
field in tool input is never trusted.

## Endpoints

- `GET /airic/v1/manifest` returns the domain release and JSON-Schema-described query/command capabilities.
- `POST /airic/v1/queries/{capabilityId}` accepts a Work correlation envelope and `input`, and returns authoritative read data.
- `POST /airic/v1/commands/{capabilityId}` additionally requires a stable `commandId`. A command receipt is `committed`, `pending`, or `rejected`.
- `GET /airic/v1/commands/{commandId}` returns the durable receipt for reconciliation after a lost response.
- `GET /airic/v1/events?cursor={eventId}` projects resumable business events as SSE; it is not the canonical audit trail.

Command request envelopes carry `workId`, `actionId`, `commandId`, `expectedDomainRelease`, optional `targetRevision`, and `input`. The receiver must reject a mismatched release or revision before mutating Business State. Unknown external results remain pending until the receiver can inspect the stable command ID; callers must not blindly retry with a new ID.

The TypeScript reference implementation is `createHttpDomainProvider` from `@airic/framework`. CertReporter is the Python reference service.
