---
name: airic-app-development
description: Build or extend an Airic 0.2 Application composed from vertical-slice Modules, including DomainProvider capabilities, module-owned WorkTypes, host authorization, optional ACP Agent embedding, Experience, tests, and framework upgrades.
---

# Airic application development

First read the application's `package.json` and use the documentation shipped with that exact `@airic/framework` version. Inspect its Domain and Application layers before changing adapters or Work Definitions.

Preserve both locality and authority: a Module owns the Domain, use cases, Operating Model, Experience, adapters and tests that change together, while internal layer boundaries keep policy independent of mechanisms. Airic links module WorkTypes and DomainProviders through Work, Action, ContextEnvelope and trace. The Application owns identity, Work access policy and its business UI. Optional ACP is only a headless Work interaction projection. Do not add a workflow engine, ACP session as business entity, approval entity, business-state table inside Airic, or direct Agent writes to application persistence.

Choose the task and read only its reference:

- Domain entity, invariant, use case, capability, receipt, source bundle: [domain-capabilities.md](references/domain-capabilities.md)
- Process, procedure, precedent, required/on-demand context, reflection method: [work-definitions.md](references/work-definitions.md)
- Application UI, API host, Work access, ACP Agent panel, Workbench or upload: [ui-and-host.md](references/ui-and-host.md)
- Idempotency, `unknown`, recovery, journal, backup or version upgrade: [reliability.md](references/reliability.md)
- Tests, architecture checks, packing and acceptance: [verification.md](references/verification.md)

Implement the smallest end-to-end behavior through public package exports. Verify the affected boundary with focused tests, then run the relevant architecture and packaging checks. In the handoff, identify affected Domain bindings, Operating digest/Git state or capability IDs when they matter; distinguish canonical trace and committed business receipts from transient Agent text.
