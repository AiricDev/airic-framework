# Reliability and versions

An Action is persisted before command dispatch. Repeating transport for the same intent reuses request and command identity; changed input is a new intent. On ambiguous failure, retain `unknown` and call `inspectCommand` before retrying. Never infer success from an Agent message.

Framework runtime files use an exclusive writer lock, immutable hash-chained commits and content-addressed objects. A crash can leave a lock; inspect it and break it only with the exact observed token after confirming the owner is gone. Close the writer before backup and verify replay on a copy.

Track framework version, storage format, immutable Operating Model revision/digest, Domain release/build ID and business revision separately. Workspace Git status is diagnostic and must not be substituted for an active Operating Model revision. Preserve the exact Work Definition documents delivered on each turn as content-addressed trace evidence. Old Action reconciliation uses its original command identity and release; a later Operating Model adoption does not alter that domain binding.

An ACP session ID is a Work-bound interaction handle, not authorization or a business revision. After reconnect or process restart, `session/load` projects the visible conversation from canonical Airic trace; refresh the Work and business object separately. If a reply was lost after a business command, inspect its stable receipt before retrying.
