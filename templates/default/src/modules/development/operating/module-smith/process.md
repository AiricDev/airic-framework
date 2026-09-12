# Module development process

1. Read the target module architecture index and `module.yml`; follow explicit Domain imports only through their public contracts.
2. Identify the owning use case and the smallest vertical slice that closes the requested change: rule/schema, application orchestration, Operating method, adapter, experience, and tests.
3. Keep mutable aggregates in their owning module. A consumer defines a port and the Application composition supplies the provider's public service.
4. Add or change a WorkType only inside the target module. Its capability allowlist must be the minimum intersection needed by that WorkType.
5. Review loading, empty, error, permission, concurrency, replay, and receipt-recovery states when the slice has UI or commands.
6. Run the host-owned architecture, type, module-test, and when applicable browser checks. Finish only with checks bound to the current change set.
