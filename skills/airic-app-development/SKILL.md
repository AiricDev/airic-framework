---
name: airic-app-development
description: Build or extend an application on Airic Framework, including clean domain modeling, DomainModule capability adapters, Markdown Work Definitions, workbench result views, file recovery contracts, reflection candidates, tests, and framework upgrades. Use when creating an Airic app or changing its domain capabilities, operating model, UI extension, or integration boundary.
---

# Airic application development

First read the application's `package.json` and use the documentation shipped with that exact `@airic/framework` version. Inspect its Domain and Application layers before changing adapters or Work Definitions.

Preserve the governing split: domain code specifies legal business meaning; Work Definition documents guide the Agent's flexible method; Airic links both through Work, Action, ContextEnvelope and trace. Do not add a workflow engine, session entity, approval entity, business-state table inside Airic, or direct Agent writes to application persistence.

Choose the task and read only its reference:

- Domain entity, invariant, use case, capability, receipt, source bundle: [domain-capabilities.md](references/domain-capabilities.md)
- Process, procedure, precedent, required/on-demand context, reflection method: [work-definitions.md](references/work-definitions.md)
- Workbench page, outcome renderer, API host, upload or definition editing: [ui-and-host.md](references/ui-and-host.md)
- Idempotency, `unknown`, recovery, journal, backup or version upgrade: [reliability.md](references/reliability.md)
- Tests, architecture checks, packing and acceptance: [verification.md](references/verification.md)

Implement the smallest end-to-end behavior through public package exports. Run the relevant focused test, then the repository architecture check and packed-application acceptance. In the handoff, state the domain release, current Work Definition digest/Git state, affected capability IDs, and evidence that a committed receipt—not Agent text—causes completion.
