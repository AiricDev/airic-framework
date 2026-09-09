# UI and host

Compose `AiricRuntime` in the application entry point and expose it through `@airic/server`. Authentication must establish the trusted actor before a domain call. Keep application business storage separate from the Airic runtime directory.

Use `AiricWorkbench` as the generic Work, conversation, outcome, context/trace and reflection shell. Register an object-type result renderer for domain-specific outcomes; do not copy or fork the generic UI. Add upload and definition-publishing callbacks in the host only when the application owns their authorization and immutable storage policy.

SSE is a projection of canonical trace. Reconnect with the last event ID; refresh should always be able to rebuild the visible state through HTTP.
