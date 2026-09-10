# Airic Framework development plan

This file is the implementation ledger for the v0.4 technical design. A phase is complete only when its observable exit conditions have evidence below.

| Phase | Deliverable | Status | Evidence |
| --- | --- | --- | --- |
| F0 | Packages, build, architecture gate, file journal, FakeHarness, generator, workbench, developer skill, Pi hook probe | implemented and verified | Architecture gate; Pi bridge probe; packed generated-app acceptance |
| F1 | Work Definition loading, DomainModule, source retrieval, ContextEnvelope, Pi adapter, end-to-end Work | implemented and live-provider verified | Runtime contracts, simulated browser path, and a real Pi/DeepSeek rejection-recovery-completion run |
| F2 | Recovery, idempotency/reconciliation, SSE reconnect, interruption and context-change trace | implemented and verified except forced live compaction | Fault injection, unknown reconciliation, snapshots, single writer, live definition reload, browser refresh, journal restart and Pi session resume |
| F3 | Git-backed generator, uploads, result views, Smith onboarding and skill | implemented and verified | Single-directory definition source, Git initialization, evidence upload, workspace policy, result-view registry, validated skill and tarball-only generated app |
| F4 | Reflection Work and reviewable Markdown/code candidates linked to Git/domain releases | implemented and verified in the example | Browser Reflection Work, candidate object/trace, Git diff handoff and domain release binding contracts |

## Release rule

The default template is the sole source of the basic demo. CI generates and installs it from packed artifacts. A phase is not considered verified by workspace links alone.

## Current evidence

- `pnpm run check`: architecture constraints, TypeScript project graph and 53 unit/component tests.
- `pnpm run test:browser`: template business navigation with partial command commit, rejection, corrected continuation, reference-typed result view, Reflection Work and candidate display.
- `pnpm run verify:pack`: packs eight public packages, installs `create-airic` into a clean temporary launcher, generates an app, installs package tarballs, builds, tests and starts both its business and Airic health endpoints.
- `quick_validate.py skills/airic-app-development`: development skill structure and frontmatter valid.

A credentialed Pi/DeepSeek run verified actual provider delivery, multi-step tool use, deterministic rejection, corrected command, completion, journal restart and same-Work session resume. See `docs/live-provider-acceptance.md`. Forced long-context compaction remains the only live Pi environment acceptance not exercised. Public npm publication and CertReporter integration remain intentionally outside this repository milestone.
