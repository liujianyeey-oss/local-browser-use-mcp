# Release checklist

1. Run `npm run verify` and require all macOS CI matrix jobs to pass.
2. In a compatible macOS desktop environment, run `doctor --online` and the
   read-only inventory probe; optionally run the example-tab probe.
3. Record date, bridge, OS, Node.js, desktop app, Runtime plugin, MCP client,
   backend and result in [COMPATIBILITY.md](COMPATIBILITY.md). Fake-backend tests
   do not establish real-browser compatibility.
4. Configure and verify a private vulnerability reporting channel in repository
   settings and update SECURITY.md. Documentation does not enable that feature.
5. Choose the version, update package.json and CHANGELOG.md, and inspect
   `npm pack --dry-run`. prepublishOnly reruns complete verification on publish.
6. After maintainer approval, create a tag and GitHub release, and publish using
   the maintainer's configured npm authentication/provenance flow.

CI has read-only repository permissions and does not publish packages. Linux
fake-backend checks do not imply Linux support for the desktop Runtime.
