# Remote business-system integration

Use a host-owned sidecar composition when Airic serves an existing business system. Keep the existing system as owner of state, authorization, revision checks, approvals, exports and durable command receipts. Airic owns Work, Action, canonical trace and recovery only.

Expose `airic-domain/v1` from the business delivery layer with a generated manifest/OpenAPI capability registry, closed input schemas, `committed | pending | rejected | unknown` receipts, inspection, and resumable events. Implement each command via an application use case plus receipt repository and transaction port: business effect, audit and final receipt commit atomically. On a lost response return `unknown`; inspect before any retry.

At the sidecar composition root, use `HttpDomainProviderOptions.requestHeaders` to sign each serialized request. Verify the signature at the business boundary, establish the actual user and permissions there, and never trust a model-supplied actor. Sidecar persistence must be separate from business state. A browser should reach its same-origin sidecar route before broad backend API proxies.

Pass selected resource/revision data as `TurnContextRef` only. It is a traceable UI hint; Work input fixes the business target, and the Agent queries the remote domain for current facts. Put business gates such as publish, approval and export outside WorkType allowlists.

Verify with a real configured provider where possible: create/resume Work, revision conflict, signed identity rejection, dropped committed reply followed by inspection, sidecar restart, and proxy routing. Do not elevate reference-specific sidecar code into a Framework runner until these flows have been proven across more than one application.
