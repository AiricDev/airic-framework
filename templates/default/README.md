# Airic application

This project is an Airic 0.2 application. The Application host composes Modules under `src/modules`; each Module owns the Domain, use cases, Operating Model, Experience and adapters for one modification closure.

```sh
pnpm install
pnpm run build
pnpm run dev
```

Open `http://127.0.0.1:4173`. Business APIs are mounted under `/api/app`, Airic under `/api/airic`, and the Workbench under `/work`.

The `cases` module is a complete example. Work results store business references such as `{ "type": "case", "id": "..." }`; its result view reloads authoritative state through the module API. The `development` module provides Module Smith and Reflection. Add a Module by creating its `module.yml` and contribution entrypoints; the generated registries discover it without editing `main.ts` or `client.tsx`.

At first start, the host explicitly imports each module package as an immutable Operating Model baseline. Runtime reads the active revision from its repository and pins it for a turn; editing the working tree does not silently change open Work. Submit a governed proposal and adopt it to activate a later revision. Executable TypeScript changes still require a rebuild and restart. Runtime and Operating Model repository data use `.airic/v2`; Git ignores local runtime/model configuration.
