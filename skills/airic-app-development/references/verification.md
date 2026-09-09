# Verification

Run domain unit tests without Airic. Add DomainModule contract tests for trusted context, input/output shape, rejection, atomic receipt persistence, inspection and release mismatch. Use FakeHarness for context closure, actual registered tool names, delivery evidence, Action ordering, completion and reflection trace.

Inject failures before and after journal rename, after domain commit but before reply, on duplicate delivery, stale revision, second writer and restart. Browser smoke must cover create Work, domain rejection, continued conversation, committed outcome, refresh and restart.

Before release, run the architecture check, build every project, pack public packages, generate into an empty directory, install only tarballs, and build/test the generated application. Reject absolute developer paths, private `src` imports, missing template/skill assets and provider types in public framework declarations.
