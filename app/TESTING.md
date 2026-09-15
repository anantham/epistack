# Testing Epistack

The test suite has three distinct jobs:

- `npm test` runs typecheck, the production build, and deterministic unit and contract tests.
- `npm run test:coverage` runs the same Node tests with V8 coverage. Coverage is useful for the pure libraries, but it does not mean that Cloudflare route handlers or browser behavior ran.
- `npm run test:browser` starts the local app and runs Chromium tests for rendered routes, stage navigation, case-scoped session restore, console errors, and forbidden localhost requests. Set `EPISTACK_E2E_BASE_URL` to run the same checks against a deployed site.
- `npm run test:integration` starts an isolated local Workers runtime with a disposable D1 database and a deterministic Astra receipt server. It exercises the real `/api/decompose-live`, `/api/jobs/stats`, and `/api/jobs/diagnostics` routes, including telemetry and index creation.

The browser tests use fixture data and do not spend model credits. A production run should still include one bounded live smoke check for `/api/backend-status`, one decomposition request, one brief compile, and one source investigation. Those checks belong in deployment verification because provider availability and D1 state are external dependencies.

The integration harness uses a real local Worker and D1, with the provider stubbed at the network boundary so no model credits are spent. The remaining high-value additions are brief resume after a closed tab, Astra 5xx and timeout fallback, typed source extraction, promotion re-verification, and migration upgrades on an existing database.
