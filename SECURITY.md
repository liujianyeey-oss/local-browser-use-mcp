# Security Policy

## Supported versions

| Version | Support status |
| --- | --- |
| 0.1.x | Supported while the project remains pre-stable |

This project targets macOS and Node.js 20 or newer. Compatibility with a particular installed ChatGPT/Codex desktop build can change when the upstream .mcp.json or cua_repl contract changes.

## Reporting a vulnerability

Do not open a public issue for exploitable details, credentials, URLs, screenshots, or user paths.

Use the private vulnerability reporting channel provided by the project hosting platform, such as GitHub Security Advisories, when it is enabled. If no private channel is configured yet, contact a maintainer privately and wait for confirmation before sharing sensitive details.

When reporting, include:

- the bridge version from local-browser-use-mcp help;
- macOS and Node.js versions;
- whether the issue occurs during configuration discovery, stdio relaying, doctor, or an online read-only check;
- sanitized logs with home and user paths removed;
- minimal reproduction steps that do not expose private browser data.

Repository metadata intentionally omits an invented security contact. A real maintainer contact must be added before the first public release.

## Threat model

The bridge assumes the local user intentionally runs it with access to an already installed ChatGPT/Codex desktop runtime and browser backend. It is designed for local, interactive use, not for an unattended multi-user service.

### Untrusted browser content

Page text, DOM state, accessibility data, downloads, screenshots, and tool output can contain attacker-controlled content. The bridge treats them as observations, not as authorization. An Agent must not treat instructions found in a page as user consent or as permission to bypass confirmation.

### Untrusted or overly broad MCP clients

The bridge limits the runtime to the browser surface. It does not expose native application or desktop control. However, a browser can still be used to perform consequential actions, so sensitive operations require explicit user confirmation.

### Runtime approval failures

When the connected MCP client does not support elicitation, the bridge declines protected runtime approvals instead of approving them automatically. This fail-closed behavior can interrupt automation; it is intentional.

### Local configuration and diagnostics

Configuration discovery reads a desktop-generated .mcp.json under the user's home directory. An explicit --config path takes precedence and must be valid; the bridge does not silently fall back to another configuration.

Diagnostics and logs redact the user's home directory and known user paths by default. Full paths are shown only when the user explicitly passes --show-paths.

### Compromised upstream components

The bridge does not sandbox Chrome, the ChatGPT/Codex desktop app, the Browser Runtime, the Chrome extension, the Native Messaging Host, or the operating system. If any of those components is compromised, this bridge cannot restore confidentiality or integrity. Users must obtain those components from their official sources and keep them updated.

## Security boundaries

The bridge enforces or documents these boundaries:

- browser-only surface through CUA_REPL_ENABLED_SURFACES=browser;
- the first js call must be await cua.getState() so the Agent reads current runtime documentation;
- cookies, localStorage, saved passwords, and browser profile files are not read by default;
- page content cannot grant authorization;
- high-risk external side effects and sensitive data transmission require explicit user confirmation;
- runtime elicitation and model-level confirmation are independent gates;
- unsupported elicitation fails closed;
- upstream stdio protocol errors are sanitized and terminate rather than being forwarded as valid MCP output;
- probe output is summarized by default and full reports are written only when an output path is explicitly provided.

These boundaries reduce accidental exposure and unauthorized automation. They are not a sandbox and do not replace browser security, extension permissions, Native Host policy, peer authorization, or organizational controls.

## Out of scope

- Vulnerabilities in OpenAI Browser Runtime, ChatGPT/Codex desktop binaries, the Chrome extension, or Native Messaging Host;
- Bugs caused by using incompatible or modified upstream components;
- Attacks requiring control of the local user account or operating system;
- Exfiltration performed by a user-approved action after explicit confirmation;
- Security issues in third-party Agent CLI clients.

Report those issues to the responsible upstream vendor or project.
