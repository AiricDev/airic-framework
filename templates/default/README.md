# Airic application starter

This application is generated from Airic's canonical starter template. Its Domain and Application layers are ordinary TypeScript; only `src/integration/airic`, `src/http` and the composition roots import Airic or the host.

The generated directory is a Git repository. `work-definitions/` is the only Operating Model source: Git manages its history, and Airic reloads the current working tree before each Agent turn. Domain Model Smith, Operating Model Smith and Experience Smith appear on the workbench home page after the Pi harness is configured.

Run `pnpm install`, `pnpm run build`, and `pnpm run dev`, then open `http://127.0.0.1:4173`.

- `/cases` and `/cases/:id` are business pages served by the application's React Router tree.
- `/work` embeds the Airic workbench for governed Agent work.
- `/api/app/**` is the business HTTP API; `/api/airic/**` is the Airic handler. Both are served by one Node HTTP server in `src/main.ts`.

The default simulated harness needs no credentials. Try `name is Ada Lovelace, ada@example.com` to complete in one turn, or `submit` first to observe a deterministic domain rejection.

`pnpm test` runs unit and component tests (`test/`); `pnpm run test:browser` runs the Playwright journeys (`e2e/`) — run `pnpm exec playwright install` once to fetch browsers. The browser suite builds the app and starts an isolated server on port 4199.

Work results store business references (for example `{ type: "case", id }`); the registered result view reads the authoritative record through the business API. Register shared services and DomainModules in `src/integration/application.ts`, business routes in `src/http/routes.ts`, and pages in `src/ui/routes.tsx` — the stable host never needs to change.

For a real model, copy `.env.example` to `.env` and `models.example.json` to `models.json`, then fill in the endpoint, key, provider and model. The development command loads `.env` without exposing its values to the browser. `models.json` references the secret through `$AIRIC_API_KEY`; do not put the literal key in that file.
