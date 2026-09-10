# Modeling distinctions

- An entity has durable identity and legal transitions.
- A value object is defined by validated value and equality, not identity.
- A domain service owns domain behavior that does not naturally belong to one entity.
- An application use case coordinates actors, persistence and external effects; it is outside this Work.
- A repository is a port owned by the application/domain boundary; infrastructure implementation is outside this Work.

Prefer business-named operations over public setters. Make invalid states unrepresentable where practical, and use explicit domain errors when callers need to distinguish rejections.
