# Airic application

This project is an Airic 0.2 application. The Application host composes Modules under `src/modules`; each Module owns the Domain, use cases, Operating Model, Experience and adapters for one modification closure.

```sh
pnpm install
pnpm run build
pnpm run dev
```

Open `http://127.0.0.1:4173`. Business APIs are mounted under `/api/app`, Airic under `/api/airic`, and the Workbench under `/work`.

The `cases` module is a complete example. Work results store business references such as `{ "type": "case", "id": "..." }`; its result view reloads authoritative state through the module API. The `development` module provides Module Smith, Reflection and Operating Model Smith. Add a Module by creating its `module.yml` and contribution entrypoints; the generated registries discover it without editing `main.ts` or `client.tsx`.

At first start, the host explicitly imports each module package as an immutable Operating Model baseline. Runtime reads the active revision from its repository and pins it for a turn; editing the working tree does not silently change open Work. Reflection binds one or more readable trajectories; Operating Model Smith maintains the installation-owned package through reviewable candidates. A candidate is structure-validated, reviewed and then adopted to activate on a later turn. Executable TypeScript changes still require a rebuild and restart. Runtime data uses `.airic/v2/runtime`; Operating Model Git uses `.airic/v2/operating-model.git` and is backed up with runtime trace/evidence data.
