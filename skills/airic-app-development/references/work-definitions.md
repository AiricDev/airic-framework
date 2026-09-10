# Work Definitions

Use Markdown for roles, process, procedure, policy, precedent and reflection method. `work.yml` gives each document a stable ID, path, role, load mode and explicit dependencies. Mark only indispensable instructions as required; make detail discoverable on demand.

Describe goals, observations and choices rather than executable workflow states. Include at least two legitimate paths when the method is intentionally flexible. Do not encode domain invariants only in prose.

Keep `work-definitions/` as the single authoritative directory and use Git for review, history and rollback. Airic reloads the current working tree before each reasoning turn, records its Git state and package digest, and stores the delivered document content as trace evidence. Uncommitted changes therefore affect the next turn of an open Work. Reflection should cite trace evidence, alternatives and blind spots, then produce a reviewable Markdown/code diff and validation cases; it must not commit Git state.
