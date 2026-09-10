# Live Pi provider acceptance

This record contains sanitized evidence from the credentialed `deepseek/deepseek-v4-flash` acceptance run. It intentionally excludes the endpoint, API key and raw provider payload.

## Governed business path

- Work: `49404e05-76a8-499c-8572-4bdbcfa21bf3`
- Delivered Work Definition digest: `aad7c2824695daff35f63e02443f2a2e444da055d168d63d3c07e31db3ac805d` (historical pre-Git acceptance)
- Pinned Domain release/build: `case-management@1.0.0`, `case-management-demo-v1`
- First turn: the model read authoritative case state and attempted readiness without customer details.
- The runtime persisted Action `7eb54325c3d66f5ba4fc9eff2c187fbb` before dispatch; the domain rejected it with `RequiredInformationMissing`.
- Second turn: the model accepted the supplied name and email, re-read state and submitted a new intent.
- Action `061d94b0219073f896d45254b2c05750` committed once; the authoritative case became `ready` at revision 2.
- The Agent completed the Work only after that committed receipt.

The canonical trace contains 53 events, 9 context assemblies and 7 confirmed deliveries. Every delivery records the envelope digest, adapter version, pre-send provider payload digest and the actual seven registered tools. The live model used queries, commands and the framework completion tool across multiple provider calls.

After a graceful process stop, the same directory reopened successfully. The completed Work restored with one rejected Action, one committed Action and one application receipt; no business effect was duplicated.

## Harness resume path

- Work: `7375f6a2-2b8b-4f47-b08f-1fd2a8a40611`
- First process: the model queried case `demo`, reported `ready` at revision 2 and left the Work open.
- After process restart: Pi continued the same Work session and answered a follow-up from prior conversational context.
- The trace contains two user messages, two Agent messages, one query, zero commands and three confirmed context deliveries.
- Pi retained one session journal for this Work across both processes.

## Defects found by the live run

1. Pi does not interpolate environment variables in `models.json` `baseUrl`. The adapter now overrides the provider endpoint directly from `.env`; API keys are installed as runtime credentials.
2. A query returning `undefined` produced invalid tool text. The bridge now serializes it as JSON `null`.
3. Journal hashing included object properties that JSON persistence omitted when their value was `undefined`. Canonical hashing now matches JSON semantics, with a reopen regression test.
4. The sample command schema did not describe nested change fields, allowing the model to invent `changes.status`. The schema is now closed and explicit, and the Domain rejects empty or unsupported changes without advancing revision.
5. The sample Work did not identify its business case. The default application now supplies `{ "caseId": "demo" }` as Work input while the reusable UI remains application-neutral.

## Confidentiality check

After the business and resume runs, 94 files under the isolated runtime directory were scanned against the exact configured endpoint and API key. Neither value was present. Only digests and non-secret provider/model identifiers appear in canonical trace.

Forced long-context compaction was not exercised; hook registration remains covered by the adapter contract test.
