# Business State and cognitive projection routing

Read this reference when an existing business system needs an Agent interface,
a cognitive projection, reflection, or an Operating Model change path.

- Keep business truth in the owner application. Airic receives typed capability
  contracts; it does not receive repositories, ORM models or write credentials.
- Put a deterministic, read-only cognitive projection in the owner application's
  application layer. It can summarize facts and gaps for reasoning, but must not
  become an authorization input, write revision source or substitute state.
- Treat the Capability API as the sole effect boundary: closed input/output
  schemas, trusted identity, commit-time permission/revision/invariant checks,
  atomic audit and idempotent receipt, then inspection for `unknown` outcomes.
- Let WorkType Operating Models teach cognitive-context-first reasoning followed
  by narrowly scoped structured reads and expected-revision commands. They may
  evolve faster than the Domain.
- Reflection creates evidence-linked proposals only through
  `OperatingModelLearningPort`. Give the Agent Runtime only
  `OperatingModelRuntimePort`, and give trusted human governance the separate
  `OperatingModelGovernancePort`; adoption is a reviewed CAS operation, never a
  Runtime-side effect.

For the architecture rationale, read
[`docs/agent-business-state-boundary.md`](../../../docs/agent-business-state-boundary.md).
