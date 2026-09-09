# Demo and acceptance path

## Simulated business path

1. Build the repository and start `@airic/template-default`.
2. Create a Work from the left rail.
3. Send `submit`. The Agent tries to finish, the domain rejects the Action because name and email are missing, and the Work remains open.
4. Send `name is Ada Lovelace, ada@example.com`. The domain commits exactly once and returns a durable receipt; the Work completes and the outcome appears in the workbench.
5. Expand Context & trace to inspect definition revision, envelope assembly/delivery, tool calls, Action intent and receipt.
6. Refresh or restart. Work and trace are rebuilt from the journal; business data is owned by the example application's separate adapter.

The alternate legal path supplies both facts in the first turn. The sequence is in the Agent operating model; readiness is a domain invariant.

## Real Pi path

Copy `templates/default/.env.example` to `templates/default/.env` and `templates/default/models.example.json` to `templates/default/models.json`. Set the endpoint and key only in `.env`, and keep matching `AIRIC_PROVIDER`/`AIRIC_MODEL` identifiers in both files. The default model example uses OpenAI Chat Completions; change `api` to `openai-responses`, `anthropic-messages`, or `google-generative-ai` when that is the protocol actually exposed by the endpoint. Then rebuild and start the same application. The development command loads `.env` automatically.

The adapter injects each current ContextEnvelope as system instructions, registers only Airic tools, and records `context`, `before_provider_request`, and compaction hooks. `context.delivered` includes the actual tool list, adapter version, envelope digest, injection points and serialized request digest. Secret values are neither copied into the ContextEnvelope nor written into framework trace.

Real model acceptance is intentionally credential-dependent. CI validates the adapter against Pi 0.80.10 types and provider-neutral contracts without sending a paid request.
