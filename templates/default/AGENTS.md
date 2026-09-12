# Airic application boundaries

- `src/app` owns composition, identity, HTTP hosting, navigation and shutdown. Keep `main.ts` and `client.tsx` stable.
- `src/modules/<module-id>` owns a vertical slice: Domain, use cases, Operating Model, Experience, adapters and tests that change together.
- Domain and Application code stay independent of Airic, HTTP, React and storage. Expose Agent operations through a module `DomainProvider`; commands return durable, inspectable receipts.
- Cross-module imports use the provider module's `public/` contracts and a consumer-owned port. Never deep-import another module or access its repository.
- WorkTypes live below their owning module's `operating/` directory. Git owns source history; Airic reloads Operating content before each model turn.
- Add module routes, pages, result views and starters through `module.yml` contributions. Do not edit the host route table for a business feature.
- Business writes enter an Application use case, which revalidates identity, authority, versions and invariants at commit time.
