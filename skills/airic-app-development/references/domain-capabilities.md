# Domain capabilities

Model entities and use cases as ordinary TypeScript with no Airic, Pi, React, HTTP or file dependencies. Put invariants in executable domain code and explain their business reason in comments or tests. Use application ports for persistence.

The outer DomainModule adapter converts Airic's trusted call context to application input. Never trust actor, scope, command ID, Work ID or authorization copied from tool arguments. A command capability must atomically persist its effect and its stable command receipt, and `inspectCommand` must query that receipt. Map deterministic rejection to a structured rejected receipt; treat transport ambiguity as `unknown`.

Pin `release`, `buildId`, and a reviewed `sourceBundle` digest. Let the Agent read relevant domain/use-case/types/tests, excluding secrets and infrastructure. Contract tests must prove schemas, release binding, durable receipt lookup and stale business revision rejection.
