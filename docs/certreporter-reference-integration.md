# CertReporter reference integration

The local reference runs three processes: CertReporter Django owns business state and exposes `airic-domain/v1`; the Node 24 sidecar owns Airic Work, Action and canonical trace; the CertReporter frontend proxies `/api/airic/**` to the sidecar before its general Django `/api/**` route. The sidecar loads built Framework packages from its sibling checkout and persists its journal separately from Django/media.

Browser bearer tokens are verified by Django's `/api/v1/users/me/` endpoint before a sidecar request becomes a trusted Airic actor. Each sidecar-to-Django capability call carries HMAC headers over method, path, timestamp, actor ID and body hash. Django re-resolves the user and permissions; payload actors are never trusted. A report/ReportType ID and revision travel as `TurnContextRef` UI hints, while the Agent must query CertReporter for authority.

`report-authoring` exposes reads plus revision-checked structured updates; `report-template-design` exposes schema/preview plus draft writes. Their Work definitions intentionally exclude publish, approve and export. CertReporter owns those explicit business gates, approval invalidation and export snapshots.

Validated in this checkout: Framework dynamic-header HTTP provider contract and type checks; Framework/server/client builds; CertReporter migration check, Django system check, protocol tests, frontend lint/build; Node syntax check for the sidecar. A full live Pi turn and restart/reconcile run requires a locally configured Django instance, valid user service actor, HMAC secret and provider configuration. Those credentials were neither read nor recorded here, so this document does not claim live-provider acceptance.

Known local-development constraints: this is a sibling-checkout composition, not a published package or production sidecar image; the existing Docker/Compose deployment is untouched; endpoint availability is intentionally checked at sidecar startup through the remote manifest.
