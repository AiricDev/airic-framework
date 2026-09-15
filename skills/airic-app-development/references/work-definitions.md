# Work Definitions

Use Markdown for roles, process, procedure, policy, precedent and reflection method. `work.yml` gives each document a stable ID, path, role, load mode and explicit dependencies. Mark only indispensable instructions as required; make detail discoverable on demand.

Describe goals, observations and choices rather than executable workflow states. Include at least two legitimate paths when the method is intentionally flexible. Do not encode domain invariants only in prose.

Keep each WorkType below its owning Module's `operating/` directory and index it from `module.yml`. This package is an import source, not Runtime's mutable input: the host explicitly imports a baseline into an `OperatingModelRepository`. Runtime reads an active immutable revision, pins it for one turn and stores delivery evidence in trace. Working-tree edits do not affect an open Work until a governed proposal is adopted. Reflection should cite trace evidence, alternatives and blind spots, then submit an evidence-bound proposal through its learning port; code suggestions go to Module Smith.
