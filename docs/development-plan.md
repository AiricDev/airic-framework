# Airic Framework development plan

This file is the implementation ledger for the v0.3 technical design. A phase is complete only when its observable exit conditions have evidence below.

| Phase | Deliverable | Status | Evidence |
| --- | --- | --- | --- |
| F0 | Packages, build, architecture gate, file journal, FakeHarness, generator, workbench, developer skill, Pi hook probe | implemented and verified | Architecture gate; Pi bridge probe; packed generated-app acceptance |
| F1 | Work Definition loading, DomainModule, source retrieval, ContextEnvelope, Pi adapter, end-to-end Work | implemented; live-provider acceptance pending credentials | Runtime contracts and simulated browser business path; Pi 0.80.10 compiles and pre-send delivery record is probed |
| F2 | Recovery, idempotency/reconciliation, SSE reconnect, interruption, version rebinding and context-change trace | implemented and locally verified; long-running live Pi compaction remains an environment acceptance | Fault injection, unknown reconciliation, snapshots, single writer, version store, context refresh and browser refresh paths |
| F3 | Generator, definition publishing, uploads, result views, independent extension example and skill | implemented and verified | Versioned definition store/API/editor, evidence upload, result-view registry, validated skill, tarball-only generated app |
| F4 | Reflection Work and reviewable Markdown/code candidates linked to later versions | implemented and verified in the example | Browser Reflection Work, candidate object/trace, explicit review outcome and later release/revision binding contracts |

## Release rule

The default template is the sole source of the basic demo. CI generates and installs it from packed artifacts. A phase is not considered verified by workspace links alone.

## Current evidence

- `npm run check`: architecture constraints, TypeScript project graph and 15 contract/recovery tests.
- `npm run test:browser`: rejection, corrected continuation, committed result, Reflection Work and candidate display.
- `npm run verify:pack`: packs seven public packages, installs `create-airic` into a clean temporary launcher, generates an app, installs package tarballs, builds, tests and starts its health endpoint.
- `quick_validate.py skills/airic-app-development`: development skill structure and frontmatter valid.

No paid provider request was made during automated validation. A configured Pi provider is the remaining environment-specific F1/F2 acceptance; `docs/demo.md` gives the exact path. Public npm publication and CertReporter integration remain intentionally outside this repository milestone.
