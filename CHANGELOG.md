# Changelog

## Unreleased

- Add regression tests and macOS CI for Node.js 20, 22 and 24.
- Run syntax, tests and unpacked-package E2E through verify and prepublishOnly.
- Bound child shutdown after EOF, timeout, signal and protocol errors.
- Bound JSONL messages to 32 MiB and diagnostic retention to 64 MiB / 1024 responses and 64 KiB stderr.
- Fix doctor path visibility and JSON-RPC tool error classification.
- Use fileURLToPath for package verification in Unicode and space-containing paths.
- Ignore filesystem-root markers during sensitive-path scanning to avoid URL false positives on Linux.
- Add contributor, compatibility and release guidance; clarify enforced security controls versus Agent instructions.

## 0.1.1

Existing baseline version; historical release details have not been reconstructed.
