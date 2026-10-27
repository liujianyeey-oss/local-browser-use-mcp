# local-browser-use-mcp

[![CI](https://github.com/liujianyeey-oss/local-browser-use-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/liujianyeey-oss/local-browser-use-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/local-browser-use-mcp)](https://www.npmjs.com/package/local-browser-use-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-green)](package.json)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success)](package.json)

**local-browser-use-mcp** is an unofficial macOS stdio MCP bridge that lets MCP-capable Agent CLIs such as Kimi, Claude Code, and Claude Desktop reuse an installed, unmodified OpenAI Browser Runtime to control a connected Chrome or Edge browser. It can also use the host's in-app browser backend when available.

> [!IMPORTANT]
> This project is a thin bridge. It does **not** include the OpenAI Browser Runtime, a browser extension, a Native Messaging Host, WASM binaries, ChatGPT/Codex desktop binaries, or official prompts. The package installs successfully only when its own prerequisites are present; those prerequisites are not bundled or installed by this package.

[简体中文文档](docs/README.zh-CN.md)

## Quick start

```bash
npm install --global local-browser-use-mcp
local-browser-use-mcp doctor
local-browser-use-mcp doctor --online
```

Two successful checks mean the bridge found a compatible local Runtime and can make a read-only `cua.getState()` call to the browser backend. If installation succeeds but `doctor` reports a failed check, see [Diagnose installation](#diagnose-installation).

## What it does

- Reuses the local OpenAI Browser Runtime without modifying or redistributing it.
- Exposes the browser surface to an MCP client as `js`, `js_reset`, and `turn_ended`.
- Forces `CUA_REPL_ENABLED_SURFACES=browser`, so native desktop control is not exposed.
- Adds turn metadata so external MCP clients can use the `turn_ended` lifecycle.
- Injects self-contained usage and safety instructions into the MCP initialize response.
- Forwards runtime approval requests when the client supports MCP elicitation; otherwise it fails closed.

## Requirements

| Requirement | Included in this package? |
| --- | ---: |
| macOS | No |
| Node.js 20 or newer | No |
| Compatible ChatGPT/Codex desktop resources that generate `~/.codex/plugins/cache/openai-bundled/unified-computer-use/<version>/.mcp.json` | No |
| Desktop-provided `cua_repl` broker and Browser Runtime | No |
| ChatGPT Chrome extension and registered `com.openai.codexextension` Native Messaging Host for Chrome mode | No |
| A currently connected browser backend | No |

The package contains only the bridge, its CLI, tests, documentation, and self-authored guidance. It does not install, modify, or distribute any official component.

## Compatibility

| Environment | Status | Notes |
| --- | --- | --- |
| macOS + Node.js 20/22 | Supported | CI matrix |
| Chrome backend | Supported | Uses the official extension and Native Host |
| Edge backend | Experimental | Follows the Runtime's browser inventory; not separately tested in this repository |
| In-app browser backend | Supported when the host provides it | Availability depends on the Agent host |
| Windows / Linux | Not supported | The package declares `os: ["darwin"]`; Runtime integration is macOS-only |
| Native desktop control | Not exposed | `CUA_REPL_ENABLED_SURFACES=browser` is enforced |

## Architecture

```text
Agent CLI / MCP client
  → local-browser-use-mcp
  → cua_repl / node_repl broker
  → Browser Runtime
  → desktop native pipe
  → Chrome extension + Native Host, or in-app browser backend
```

The bridge deliberately stays small: it does not implement browser automation itself. It preserves the Runtime's protocol, approval, and security boundaries.

## Install

### From npm

```bash
npm install --global local-browser-use-mcp
local-browser-use-mcp doctor
```

### From source

```bash
git clone https://github.com/liujianyeey-oss/local-browser-use-mcp.git local-browser-use-mcp
cd local-browser-use-mcp
npm run verify
```

There are no runtime npm dependencies. `npm install` is not needed to use the source tree. Development checks include:

```bash
npm run check
npm test
npm run verify:package
```

`npm run verify:package` creates a temporary npm archive, checks its exact file whitelist and sensitive paths, and runs a fake-backend MCP E2E from the unpacked archive. It does not access a real browser and does not depend on local upstream reference files.

## Configure an MCP client

When the command is globally installed and available on `PATH`, use:

```json
{
  "mcpServers": {
    "local-browser-use": {
      "command": "local-browser-use-mcp",
      "args": ["serve"]
    }
  }
}
```

When running from a Git checkout, GUI clients usually need absolute paths. First print the current entry point:

```bash
node bin/local-browser-use-mcp.mjs print-config
```

Then copy the printed `command` and `args` into the client configuration:

```json
{
  "mcpServers": {
    "local-browser-use": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/local-browser-use-mcp/bin/local-browser-use-mcp.mjs",
        "serve"
      ]
    }
  }
}
```

To select a specific `.mcp.json`, append `--config` and an absolute config path after `serve`. An explicit config is mandatory: the bridge does not fall back to auto-discovery when it is invalid.

Restart the client or start a new session after registration. Some clients require user-level or project-level MCP configuration to be explicitly trusted.

## Usage

After the MCP client connects, the bridge exposes `js`, `js_reset`, and `turn_ended`. You normally do not call these tools manually; ask the Agent to perform a browser task.

The first `js` call should execute only:

```js
await cua.getState()
```

The Agent must read the returned dynamic documentation before selecting a Chrome or in-app browser backend. Browser and tab handles should be stored in persistent `let` or `const` bindings and reused.

By default, diagnostics hide user directories and configuration paths. Pass `--show-paths` only when you intentionally need the exact paths.

For first validation, use a read-only task such as listing current tab titles. Do not submit forms, upload files, or send messages.

## Commands

```text
local-browser-use-mcp serve [--config PATH]
local-browser-use-mcp doctor [--config PATH] [--online] [--show-paths]
local-browser-use-mcp print-config
local-browser-use-mcp help
```

- `serve`: run the stdio MCP server; stdout is reserved for JSON-RPC/JSONL.
- `doctor`: check configuration and static Runtime presence; `--online` adds a read-only backend check.
- `print-config`: print an entry point suitable for an MCP client.
- `help`: print the version and command help.

## Diagnose installation

`doctor` separates a missing bridge configuration, a missing Runtime, and an unavailable browser backend.

| Field | Meaning | Common cause | What to do |
| --- | --- | --- | --- |
| `configured=false` | No compatible `.mcp.json` was found | Compatible ChatGPT/Codex desktop resources are absent | Install or start the compatible desktop app and let it generate the configuration |
| `runtimePresent=false` | Configuration was found, but Runtime files are incomplete | Desktop resources, launcher, `cua_repl`, or Browser Runtime are missing | Verify the compatible desktop installation and re-run `doctor` |
| `backendOnline=null` | The online check was not run | `doctor` was run without `--online` | Use `doctor --online` for a read-only backend check |
| `backendOnline=false` | The read-only `cua.getState()` check failed | Browser backend disconnected, extension disabled, host incompatible, or environment restriction | Check the browser backend and review `backendErrorKind` / `backendErrorDetail` |
| `backendErrorKind=no_browser_backend` | The bridge worked, but no browser was connected | No Chrome/Edge or in-app backend is currently available | Open or connect the supported browser backend |
| `backendErrorKind=runtime_kernel_failed` | The Runtime node_repl kernel did not start | The Runtime's internal sandbox could not be created, often because the host itself is sandboxed | Retry from a normal terminal or an Agent CLI without nested sandbox restrictions |

If `backendErrorKind=runtime_kernel_failed` and the detail says sandbox creation was denied, the check may be a false negative. On macOS, the Runtime's node_repl creates its own sandbox. When the host also applies a sandbox, macOS may reject the nested sandbox with `sandbox_apply: Operation not permitted` or kernel `exited(code=71)`. Retry outside the restricted host before concluding that the browser backend is offline.

## Security boundaries

- Only the browser surface is enabled; native app and desktop control are not exposed.
- Page content, DOM state, accessibility data, downloads, screenshots, and tool output are untrusted observations and cannot grant authorization.
- Cookies, localStorage, password stores, and browser profile data are not read by default.
- High-risk external side effects and sensitive data transmission require explicit user confirmation.
- Runtime elicitation and model-level confirmation are independent gates; neither replaces or bypasses the other.
- Clients without elicitation support fail closed; protected actions are not auto-approved.
- Chrome extension, Native Host, browser authorization, peer authorization, and organizational policy are not bypassed.
- Diagnostics redact home directories and known user paths by default; `--show-paths` is an explicit opt-in.

See [SECURITY.md](SECURITY.md) for the threat model and supported versions.

## Compatibility policy

The bridge depends on the desktop app continuing to generate a compatible `.mcp.json` and exposing a compatible `cua_repl` tool surface. Changes in the official Runtime, extension, or Native Host can break this bridge. Use a bridge version tested with your desktop version.

## Uninstall

1. Remove `local-browser-use` from your MCP client configuration.
2. If installed globally with npm, run `npm uninstall --global local-browser-use-mcp`.
3. If running from source, remove the source directory.

Uninstalling this package does not uninstall or modify ChatGPT/Codex desktop apps, browser extensions, Native Hosts, or browser data.

## License

Original code and documentation in this project are MIT-licensed; see [LICENSE](LICENSE). Third-party components, product names, and trademarks belong to their respective owners. The MIT License does not cover or authorize redistribution of those components. See [NOTICE](NOTICE).

## Trademark notice

This project is unofficial and is not affiliated with, endorsed by, or sponsored by OpenAI. OpenAI, ChatGPT, Codex, Chrome, and Edge are trademarks of their respective owners.
