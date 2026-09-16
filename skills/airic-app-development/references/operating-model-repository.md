# Operating Model Repository

Read this reference when a task changes how an Operating Model is imported,
read, proposed, reviewed, adopted or recovered.

- Keep Module discovery separate from Operating Model content. `module.yml`
  identifies a package location; a host explicitly imports that package as an
  immutable baseline revision.
- Give Runtime only `OperatingModelRuntimePort`; it resolves active and reads a
  revision. Resolve at turn start and pin it through context refresh and
  completion checks. A newly adopted revision is visible on the next turn.
- Give authoring Works only `OperatingModelAuthoringPort`. Reflection must bind
  source Works append-only and cite their trace events; Operating Model Smith
  must bind its target package. Both submit a structured change set against an
  exact base revision. The host allowlists these WorkTypes, so package content
  cannot grant itself authoring authority.
- Give a trusted human application surface `OperatingModelGovernancePort`.
  Review, rejection and adoption are governance effects, not Runtime effects.
  Adoption must compare expected active revision, candidate digest and approved
  review digest; on `unknown`, inspect the stable operation ID before retrying.
- Treat revisions, proposals, reviews and adoption records as immutable. A
  candidate is materialized and structure-validated as a complete package at
  proposal time; adoption promotes that exact candidate. A changed proposal
  supersedes rather than edits its predecessor.
- Git is only the default storage adapter. Keep Git refs, commits and checkout
  behavior out of public application contracts. Store its private refs in the
  runtime data directory, never in or beside the developer checkout. Baseline
  import occurs only on first installation; framework updates are intentionally
  discussed and absorbed through ordinary agent work, not an upstream lifecycle.

The repository is an Airic Operating Model asset boundary. It is separate from
the business system's Cognitive Projection and Business State; see
[agent-business-state-boundary.md](agent-business-state-boundary.md).
