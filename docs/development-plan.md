# Airic Framework development plan

This file is the implementation ledger for the v0.3 technical design. A phase is complete only when its observable exit conditions have evidence below.

| Phase | Deliverable | Status | Evidence |
| --- | --- | --- | --- |
| F0 | Packages, build, architecture gate, file journal, FakeHarness, generator, workbench, developer skill, Pi hook probe | implemented and verified | Architecture gate; Pi bridge probe; packed generated-app acceptance |
| F1 | Work Definition loading, DomainModule, source retrieval, ContextEnvelope, Pi adapter, end-to-end Work | implemented and live-provider verified | Runtime contracts, simulated browser path, and a real Pi/DeepSeek rejection-recovery-completion run |
| F2 | Recovery, idempotency/reconciliation, SSE reconnect, interruption, version rebinding and context-change trace | implemented and verified except forced live compaction | Fault injection, unknown reconciliation, snapshots, single writer, version store, context refresh, browser refresh, journal restart and Pi session resume |
| F3 | Generator, definition publishing, uploads, result views, independent extension example and skill | implemented and verified | Versioned definition store/API/editor, evidence upload, result-view registry, validated skill, tarball-only generated app |
| F4 | Reflection Work and reviewable Markdown/code candidates linked to later versions | implemented and verified in the example | Browser Reflection Work, candidate object/trace, explicit review outcome and later release/revision binding contracts |

## Release rule

The default template is the sole source of the basic demo. CI generates and installs it from packed artifacts. A phase is not considered verified by workspace links alone.

## Current evidence

- `npm run check`: architecture constraints, TypeScript project graph and 17 contract/recovery tests.
- `npm run test:browser`: rejection, corrected continuation, committed result, Reflection Work and candidate display.
- `npm run verify:pack`: packs seven public packages, installs `create-airic` into a clean temporary launcher, generates an app, installs package tarballs, builds, tests and starts its health endpoint.
- `quick_validate.py skills/airic-app-development`: development skill structure and frontmatter valid.

A credentialed Pi/DeepSeek run verified actual provider delivery, multi-step tool use, deterministic rejection, corrected command, completion, journal restart and same-Work session resume. See `docs/live-provider-acceptance.md`. Forced long-context compaction remains the only live Pi environment acceptance not exercised. Public npm publication and CertReporter integration remain intentionally outside this repository milestone.
