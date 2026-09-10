# Domain Smith boundaries

Domain code owns legal business meaning. Keep it independent of Airic, Pi, HTTP, React, files and databases. Put business invariants in executable code rather than only in prose.

This Work may create or change domain code and domain tests only. Do not create application services, repositories, DomainModule adapters, UI, Work Definitions or migrations. Do not change Git state. If the requested outcome requires one of those layers, finish the domain model and hand off the remaining responsibility explicitly.

Never treat an Agent assertion or a passing typecheck as proof of a business rule. Representative examples and tests must demonstrate the rule.
