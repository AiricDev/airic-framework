# Application integration

Keep the application's Domain Model and use cases free of Airic imports. Put business entities, invariants, revisions, policies and application ports there. In an outer adapter, expose reviewed use cases as a `DomainModule`:

- Queries and pure computations return structured, schema-described observations.
- Commands receive identity and authority from `TrustedCallContext`, not tool input.
- Persist the business effect and command receipt in the application's own atomic commit.
- Implement `inspectCommand` so `unknown` delivery outcomes can be reconciled safely.
- Bind a release, build ID and reviewed source bundle; expose only source intended for Agent reading.

Write flexible collection order, communication practice, precedent and reflection method in a Work Definition. `work.yml` declares required and on-demand documents. Required dependency closure is injected on every reasoning run; on-demand retrieval is traced and enters the next envelope.

At the composition root, create a file store, DefinitionSource and harness, register application DomainModules, open `AiricRuntime`, and pass it to `createAiricServer`. The default React workbench consumes only HTTP/SSE and accepts object-type result renderers.

Use the version-matched [development skill](../skills/airic-app-development/SKILL.md) as the task-oriented entry point.
