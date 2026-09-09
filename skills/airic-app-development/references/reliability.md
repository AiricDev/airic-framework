# Reliability and versions

An Action is persisted before command dispatch. Repeating transport for the same intent reuses request and command identity; changed input is a new intent. On ambiguous failure, retain `unknown` and call `inspectCommand` before retrying. Never infer success from an Agent message.

Framework runtime files use an exclusive writer lock, immutable hash-chained commits and content-addressed objects. A crash can leave a lock; inspect it and break it only with the exact observed token after confirming the owner is gone. Close the writer before backup and verify replay on a copy.

Track framework version, storage format, Work Definition revision, Domain release/build ID and business revision separately. Old Action reconciliation uses its original command identity and release. New calls after an implementation change require Work rebinding.
