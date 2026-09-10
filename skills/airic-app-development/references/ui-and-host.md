# UI and host

Compose `AiricRuntime` in the application entry point and expose it through `@airic/server`. Authentication must establish the trusted actor before a domain call. Keep application business storage separate from the Airic runtime directory.

Use `AiricWorkbench` as the generic Work, conversation, outcome, context/trace and reflection shell. Register an object-type result renderer for domain-specific outcomes; do not copy or fork the generic UI. Show the project-owned Operating Model as a read-only working-tree view with Git status/diff; edits come from authorized project tools or an external editor, and Git owns durable change management.

SSE is a projection of canonical trace. Reconnect with the last event ID; refresh should always be able to rebuild the visible state through HTTP.
