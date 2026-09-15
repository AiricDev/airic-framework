# Agent–Business State boundary

> **Preserve the domain; replace the interaction model; evolve the operating model.**

Airic is an interaction and operating-model runtime. It helps people and Agents reason about an existing business system; it does not become that system's source of truth.

## Stable and changeable responsibilities

| Concern | Owner | Stability |
|---|---|---|
| Domain / Business State | The business system | Stable semantic anchor: invariants, versions, authorization, audit and records of fact |
| Cognitive Interface | The business system | A deterministic, read-only projection of authoritative state for Agent reasoning |
| Capability API | The business system | The only business-effect boundary: typed, validated, authorized, transactional and auditable |
| Operating Model | Airic WorkType package, selected by the host | Evolves frequently: process, criteria, recovery and precedents |
| Reflection | Airic | Produces reviewable, evidence-linked suggestions only |

The Cognitive Interface is neither a database representation nor a human HTML view. It may combine structured facts, gaps and a concise Markdown summary, but it must be derived from current authoritative state. A projection never supplies an identity, an authorization decision, a revision for a write, or a new source of business fact.

## Effects and trust

An Agent never writes Business State directly. It calls a Capability API and the business application rechecks identity, permission, schema, expected revision and domain invariants at commit time. The application atomically records the effect and its audit/command receipt. Lost transport responses are `unknown`; inspect and reconcile before another attempt.

Airic owns ContextEnvelope, Work, Action, canonical trace, evidence and non-authoritative UI context references. A Work binding scopes what an Agent can attempt; it does not replace the business system's authority checks or domain version binding.

## Reflection is advisory

Reflection may correlate trace evidence, rejections, conflicts and later human edits into a candidate Operating Model change. It must not rewrite historical trace, alter authorization, modify Business State, or mark a candidate adopted by itself.

An Operating Model is simultaneously executable guidance, a business asset, and runtime input. Its lifecycle belongs behind an immutable `OperatingModelRepository`, not in Runtime state or a domain database. Three deliberately narrow ports share one repository: `OperatingModelRuntimePort` resolves and reads active revisions; `OperatingModelLearningPort` can submit an evidence-bound proposal from a Reflection Work; `OperatingModelGovernancePort` lets the trusted human host propose, review, reject, adopt and reconcile operations. Runtime pins one active revision for a turn and observes a replacement only on the next turn. Proposal, review, revision and adoption records are immutable; adoption is a CAS over the active revision, proposal digest and approved review digest. Git is the reference adapter, never a public contract.

## Consequence for integrations

Use a sidecar and `airic-domain/v1` when the business system is Python, Java, Node or another stack. Keep its Cognitive Interface and Capability API in the business application's application layer. Airic discovers, calls and traces them without importing business types or generating generic projections.
