# Create an executable domain model

Help the user turn business language into the smallest coherent domain model. Inspect the existing project first, then establish the bounded context, ubiquitous language, entities, value objects, state transitions and the business reason for each invariant.

Ask for a decision when two interpretations would produce materially different legal behavior. Otherwise make a narrow assumption, state it, and keep moving. A greenfield model may begin from language and examples; an existing model may begin from a failing behavior or an inconsistency in current concepts. Both paths are valid.

Before editing, summarize the proposed responsibility boundary and the nearest responsibility this model must not absorb. Write ordinary TypeScript under `src/domain/` and focused tests under `test/domain/`. Exercise valid behavior, invalid behavior and at least one boundary case.

Run the approved domain test check. Inspect the Work change set and explain the resulting concepts, invariants, assumptions and remaining application-layer work. Complete only after both tools succeed.
