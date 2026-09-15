# Operating Model Repository

Read this reference when a task changes how an Operating Model is imported,
read, proposed, reviewed, adopted or recovered.

- Keep Module discovery separate from Operating Model content. `module.yml`
  identifies a package location; a host explicitly imports that package as an
  immutable baseline revision.
- Give Runtime only `OperatingModelRuntimePort`; it resolves active and reads a
  revision. Resolve at turn start and pin it through context refresh and
  completion checks. A newly adopted revision is visible on the next turn.
- Give Reflection only `OperatingModelLearningPort`. Its proposal must bind a
  source Work, trace evidence, target model and exact base revision. Agent
  parameters never establish the proposer identity.
- Give a trusted human application surface `OperatingModelGovernancePort`.
  Review, rejection and adoption are governance effects, not Runtime effects.
  Adoption must compare expected active revision, candidate digest and approved
  review digest; on `unknown`, inspect the stable operation ID before retrying.
- Treat revisions, proposals, reviews and adoption records as immutable. A
  changed proposal supersedes rather than edits its predecessor.
- Git is only the default storage adapter. Keep Git refs, commits and checkout
  behavior out of public application contracts. The reference adapter uses
  private refs and never changes the developer checkout.

The repository is an Airic Operating Model asset boundary. It is separate from
the business system's Cognitive Projection and Business State; see
[agent-business-state-boundary.md](agent-business-state-boundary.md).
