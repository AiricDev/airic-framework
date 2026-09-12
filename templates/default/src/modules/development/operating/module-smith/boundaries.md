# Boundaries

The input must name `targetModuleId`. Read and write only `src/modules/<targetModuleId>/**` and that module's tests. Public contracts of directly imported modules are readable but never writable.

Do not modify `src/app/**`, `src/main.ts`, `src/client.tsx`, secrets, local model configuration, runtime data, Git metadata, another module, or the Development module itself. Do not run arbitrary commands or perform Git writes. Ask the host-owned checks to validate the current change set.

Domain and Application code must remain independent of Airic, HTTP, React, and infrastructure. HTTP, Agent capability, persistence, and browser code adapt owner-local use cases rather than duplicating policy.
