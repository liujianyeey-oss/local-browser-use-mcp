# Compatibility evidence

CI defines macOS jobs for Node.js 20, 22 and 24. Check GitHub Actions results;
a workflow definition alone is not evidence of a passing matrix.

| Scope | Environment | Result |
| --- | --- | --- |
| Fake-backend regression and package checks | OpenCloudOS 9.4, Node.js 24.13.0 | Passed on 2026-10-28: 20 tests and packaged MCP E2E |
| Real browser integration | macOS desktop / Runtime / client versions not recorded | Not verified by this change |

Before advertising a tested real-browser configuration, record the date, bridge
version, OS, Node.js, desktop app, Runtime plugin, MCP client, backend and probe
result. Omit personal paths, tab titles, URLs and browser contents.
Linux fake-backend test success does not extend the macOS-only Runtime support.
