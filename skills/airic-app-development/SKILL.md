---
name: airic-app-development
description: Build or extend an Airic 0.2 Application composed from vertical-slice Modules, including DomainProvider capabilities, module-owned WorkTypes, server/browser contributions, reflection, tests, and framework upgrades.
---

# Airic application development

First read the application's `package.json` and use the documentation shipped with that exact `@airic/framework` version. Inspect its Domain and Application layers before changing adapters or Work Definitions.

Preserve both locality and authority: a Module owns the Domain, use cases, Operating Model, Experience, adapters and tests that change together, while internal layer boundaries keep policy independent of mechanisms. Airic links module WorkTypes and DomainProviders through Work, Action, ContextEnvelope and trace. Do not add a workflow engine, session entity, approval entity, business-state table inside Airic, or direct Agent writes to application persistence.

Choose the task and read only its reference:

- Domain entity, invariant, use case, capability, receipt, source bundle: [domain-capabilities.md](references/domain-capabilities.md)
- Process, procedure, precedent, required/on-demand context, reflection method: [work-definitions.md](references/work-definitions.md)
- Workbench page, outcome renderer, API host, upload or definition editing: [ui-and-host.md](references/ui-and-host.md)
- Idempotency, `unknown`, recovery, journal, backup or version upgrade: [reliability.md](references/reliability.md)
- Tests, architecture checks, packing and acceptance: [verification.md](references/verification.md)

Implement the smallest end-to-end behavior through public package exports. Run the relevant focused test, then the repository architecture check and packed-application acceptance. In the handoff, state the domain release, current Work Definition digest/Git state, affected capability IDs, and evidence that a committed receipt—not Agent text—causes completion.
