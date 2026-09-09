# Airic application boundaries

- Keep `src/domain` and `src/application` independent of Airic, Pi, HTTP, files, and React.
- Expose use cases through a DomainModule in `src/adapters`; commands must return durable receipts and support inspection by command ID.
- Express flexible work methods in `work-definitions`; do not compile them into a workflow state machine.
- Extend the workbench with result views instead of copying its source.
- Use the version-matched `airic-app-development` skill before changing architecture.
