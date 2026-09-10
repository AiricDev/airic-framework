# Airic transaction assistance example

This application is generated from Airic's canonical starter template. Its Domain and Application layers are ordinary TypeScript; only adapters and the composition root import Airic.

The generated directory is a Git repository. `work-definitions/` is the only Operating Model source: Git manages its history, and Airic reloads the current working tree before each Agent turn. Domain Model Smith and Operating Model Smith appear on the workbench home page after the Pi harness is configured.

Run `npm install`, `npm run build`, and `npm run dev`, then open `http://127.0.0.1:4173`.

The default simulated harness needs no credentials. Try `name is Ada Lovelace, ada@example.com` to complete in one turn, or `submit` first to observe a deterministic domain rejection.

For a real model, copy `.env.example` to `.env` and `models.example.json` to `models.json`, then fill in the endpoint, key, provider and model. The development command loads `.env` without exposing its values to the browser. `models.json` references the secret through `$AIRIC_API_KEY`; do not put the literal key in that file.
