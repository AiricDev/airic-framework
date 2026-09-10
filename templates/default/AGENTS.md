# Airic application boundaries

- Keep `src/domain` and `src/application` independent of Airic, Pi, HTTP, files, and React.
- Expose use cases through a DomainModule in `src/integration/airic`; commands must return durable receipts and support inspection by command ID.
- Register shared services and DomainModules in `src/integration/application.ts`, business API routes in `src/http/routes.ts`, and pages in `src/ui/routes.tsx`; keep `src/main.ts` and `src/client.tsx` stable.
- Express flexible work methods in `work-definitions`; do not compile them into a workflow state machine.
- Extend the workbench with result views that store business references, instead of copying its source.
- Use the version-matched `airic-app-development` skill before changing architecture.
