# Vertical-slice architecture

A Module is the modification-closure and capability-ownership boundary. Put files that commonly change together under the same module, while retaining dependency direction inside it:

`experience/infrastructure -> application -> domain`

Cross-module TypeScript imports may target only `public/`. Cross-module behavior uses a consumer-owned application port. Module imports make a provider available but never authorize a Work; authorization remains the WorkType capability allowlist intersected with host policy.
