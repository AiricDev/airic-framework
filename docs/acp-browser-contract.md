# Browser ACP contract

`@airic/acp` is an optional host adapter, not a Framework core dependency. The Application creates an Airic Work through authenticated HTTP, then embeds an ACP client in its own page. The WebSocket is same-origin at `/api/airic/works/:workId/acp`; the host mounts its upgrade handler on the same Node server as `/api/app` and `/api/airic`.

The host configures one trusted public origin (`AIRIC_PUBLIC_ORIGIN` in the template, defaulting to its local URL). For a reverse proxy, set this to the browser-visible HTTPS origin so the returned `wss:` URL and strict Origin check agree. Never derive that trust boundary from an arbitrary request Host header.

## Connection sequence

1. Call `GET /api/airic/works/:workId/agent-connection` with the application's session cookie. The successful DTO is `{ url, cwd, sessionId? }`. Do not construct or accept a client-supplied `cwd`.
2. Open the returned WebSocket using the official ACP client SDK and call `initialize`.
3. If `sessionId` is absent, call `session/new` with that exact `cwd`, empty `mcpServers`, and no additional directories. If present, call `session/load` with that session ID and the same fixed setup. There is one persistent ACP session per Work; a second `session/new` fails.
4. Send text blocks through `session/prompt`; call `session/cancel` to interrupt the current turn. Concurrent prompts for one Work fail with `WorkBusy`. Attachments use the authenticated Airic upload API, not ACP prompt blocks.

`session/update` carries transient text deltas and tool phases while a turn runs. `session/load` reconstructs visible user/Agent messages and tool phases from canonical Airic trace after a reconnect or process restart. Re-fetch Work and business objects through HTTP after reconnect: a WebSocket update is never the authoritative report, approval or export state.

## UI states for an embedded Agent panel

| State | Trigger | User action |
|---|---|---|
| Connecting | Connection DTO or WebSocket/initialize pending | Show progress; retain current business page. |
| Ready | Session created or loaded | Author may prompt; read-only viewers may only inspect. |
| Running | Prompt in flight | Stream text/tool status and offer Cancel to an authorized actor. |
| Recovering | Socket closes or process restarts | Re-fetch connection DTO, load existing session, then refresh Work and business APIs. |
| Forbidden | HTTP 401/403, WebSocket 403, or access revoked during updates | Stop reconnecting until identity/permission changes; hide prompt and cancel. |
| Failed | Protocol, model or network error other than access denial | Show retry and canonical Work/trace refresh. Do not assume a business command failed without checking its receipt. |

The host checks actor and Work authorization at handshake and every ACP call. It also rechecks delivery during a turn and capability execution in Runtime. ACP does not expose browser filesystem, terminal, MCP servers or arbitrary working directories. Report submission, review, approval and export stay in module Application Services and business HTTP APIs. A Work without a trusted creator is not automatically visible to the current user.

This first transport targets same-origin browser embedding. It does not promise generic desktop ACP transport compatibility. The Application owns its layout; ACP Components or another client UI may be used without adopting the Airic Workbench.
