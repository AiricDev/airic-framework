# UI and host

Compose `AiricRuntime` in the application entry point and expose it through `@airic/server`. Authentication must establish the trusted actor before a domain call. Keep application business storage separate from the Airic runtime directory.

The application host creates one Node HTTP server with a fixed route order: business API under `/api/app/**`, the Airic handler under `/api/airic/**` (`createAiricHttpHandler`), production static assets (`createStaticHandler`), then a structured 404. Both handlers receive the same trusted actor from the host's `authenticate`; HTTP input can never override actor, scope or command identity.

Use `AiricWorkbench` as the generic Work, conversation, outcome, context/trace and reflection shell. Register an object-type result renderer for domain-specific outcomes; do not copy or fork the generic UI. The workbench consumes a `client` prop (or an `AiricProvider` context from `@airic/client`'s `createAiricClient`); `apiBase` is deprecated. Show the project-owned Operating Model as a read-only working-tree view with Git status/diff; edits come from authorized project tools or an external editor, and Git owns durable change management.

Business navigation, lists and detail pages belong to the application's React Router tree (`src/ui/routes.tsx`); the workbench is embedded under `/work`. Construct shared services and register DomainModules in `src/integration/application.ts`, business routes in `src/http/routes.ts`, and pages in `src/ui/routes.tsx` so `src/main.ts` and `src/client.tsx` stay stable. Result views store business references and read the authoritative object through the business API.

SSE is a projection of canonical trace. Reconnect with the last event ID; refresh should always be able to rebuild the visible state through HTTP.
