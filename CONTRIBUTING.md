# Contributing

Use Node.js 20 or newer. Real desktop Runtime integration requires macOS;
fake-backend development checks do not require a browser or Runtime installation.
The project has no npm dependencies.

Run `npm run verify` before proposing changes. It checks syntax, regression tests
and an unpacked-package MCP E2E. Test discovery fails if no test files exist.
Add behavioral regression tests for approvals, configuration, diagnostics,
protocol changes and process cleanup. Keep stdout reserved for MCP JSONL in serve
mode and do not put credentials or browser content in fixtures or issues.

Optional macOS integration checks are `doctor --online` and `npm run smoke`.
`npm run smoke:tab` creates, reads and closes an example.com tab; run it only
in an appropriate connected browser session.

See [release guidance](docs/RELEASING.md).
