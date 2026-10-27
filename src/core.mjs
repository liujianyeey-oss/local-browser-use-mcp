// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";

const LIVE_CONFIG_ROOT = ".codex/plugins/cache/openai-bundled/unified-computer-use";
const PATH_PLACEHOLDER = "[REDACTED]";

function fail(message) {
  const error = new Error(message);
  error.code = "LOCAL_BROWSER_USE_CONFIG";
  return error;
}

function parseConfig(pathname) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(pathname, "utf8"));
  } catch (error) {
    throw fail(`invalid unified-computer-use config JSON: ${error.message}`);
  }
  const server = parsed?.mcpServers?.cua_repl;
  if (server == null || typeof server !== "object" || Array.isArray(server)) {
    throw fail("unified-computer-use config is missing mcpServers.cua_repl");
  }
  if (typeof server.command !== "string" || server.command.length === 0) {
    throw fail("unified-computer-use config has an empty cua_repl command");
  }
  if (!Array.isArray(server.args) || server.args.some((value) => typeof value !== "string")) {
    throw fail("unified-computer-use config has non-string cua_repl args");
  }
  if (server.args.length === 0) {
    throw fail("unified-computer-use config has empty cua_repl args");
  }
  if (server.env != null && (typeof server.env !== "object" || Array.isArray(server.env) ||
      Object.entries(server.env).some(([key, value]) => key === "" ||
        typeof value !== "string"))) {
    throw fail("unified-computer-use config has an invalid cua_repl env object");
  }
  return {server, version: path.basename(path.dirname(pathname))};
}

function versionValue(value) {
  const match = /^v?(\d+(?:\.\d+)*)(?:[.-].*)?$/.exec(value);
  return match == null ? null : match[1].split(".").map(Number);
}

function compareNumericVersions(a, b) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function discoverLiveConfig({ home, explicitPath } = {}) {
  if (explicitPath) {
    const pathname = path.resolve(explicitPath);
    let stats;
    try {
      stats = fs.statSync(pathname);
    } catch (error) {
      throw fail(`cannot read explicit config: ${error.message}`);
    }
    if (!stats.isFile()) throw fail("explicit config is not a regular file");
    const {server, version} = parseConfig(pathname);
  return {configPath: pathname, server, version};
  }

  const root = path.join(home ?? process.env.HOME ?? "", LIVE_CONFIG_ROOT);
  let versions = [];
  try {
    versions = fs.readdirSync(root, {withFileTypes: true})
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw fail(`cannot inspect unified-computer-use config root: ${error.message}`);
    }
  }
  const candidates = [];
  for (const version of versions) {
    const pathname = path.join(root, version, ".mcp.json");
    if (!fs.existsSync(pathname)) continue;
    try {
      const parsed = parseConfig(pathname);
      const candidate = {
        path: pathname,
        ...parsed,
        versionKey: versionValue(parsed.version),
      };
      candidates.push(candidate);
    } catch (error) {
      process.emitWarning(
        "skipping invalid unified-computer-use config: " + PATH_PLACEHOLDER,
        {code: "LOCAL_BROWSER_USE_INVALID_CONFIG"},
      );
    }
  }
  if (candidates.length === 0) {
    throw fail("no valid desktop-generated unified-computer-use .mcp.json found");
  }
  candidates.sort((a, b) => compareNumericVersions(a.versionKey ?? [], b.versionKey ?? []));
  const bestVersionKey = candidates[candidates.length - 1].versionKey ?? [];
  const sameVersion = candidates.filter((candidate) =>
    compareNumericVersions(candidate.versionKey ?? [], bestVersionKey) === 0);
  sameVersion.sort((a, b) => fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs);
  const best = sameVersion[0];
  const {path: configPath, server, version} = best;
  return {configPath, server, version};
}

export const loadLiveConfig = discoverLiveConfig;

export function browserOnlyEnvironment(serverEnvironment = {}) {
  return {
    ...serverEnvironment,
    CUA_REPL_ENABLED_SURFACES: "browser",
    NODE_REPL_DISABLE_ANALYTICS: "1",
  };
}

export function createApprovalBridge({ log = () => {} } = {}) {
  let clientSupportsElicitation = false;
  return {
    handleClient(message) {
      if (message?.method !== "initialize") return message;
      clientSupportsElicitation = message.params?.capabilities?.elicitation != null;
      if (clientSupportsElicitation) return message;
      return {
        ...message,
        params: {
          ...message.params,
          capabilities: {...message.params?.capabilities, elicitation: {}},
        },
      };
    },
    handleServer(message) {
      if (message?.method !== "elicitation/create" || message.id == null) {
        return {forward: message, response: null};
      }
      if (clientSupportsElicitation) return {forward: message, response: null};
      const meta = message.params?.meta ?? {};
      log({
        action: "decline",
        connector_id: meta.connector_id ?? null,
        tool_name: meta.tool_name ?? null,
      });
      return {
        forward: null,
        response: {
          jsonrpc: "2.0",
          id: message.id,
          result: {action: "decline", content: {}},
        },
      };
    },
  };
}

export function resolveRuntimeChecks(server, {home = process.env.HOME ?? ""} = {}) {
  const environment = browserOnlyEnvironment(server.env);
  const moduleDirectories = (environment.NODE_REPL_NODE_MODULE_DIRS ?? "")
    .split(path.delimiter)
    .flatMap((directory) => [
      directory,
      path.join(directory, "runtime"),
    ])
    .filter(Boolean);
  const browserPackages = moduleDirectories.map((directory) =>
    path.join(directory, "@oai", "browser-desktop"));
  const browserRuntime = browserPackages.find((candidate) =>
    fs.existsSync(path.join(candidate, "scripts", "browser-client.mjs")) &&
    fs.existsSync(path.join(candidate, "scripts", "browser-service.mjs")),
  ) ?? null;
  const chromeNativeHost = path.join(
    home,
    "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.openai.codexextension.json",
  );
  return {
    launcherExists: fs.existsSync(server.command),
    cuaReplExists: server.args.some((argument) =>
      fs.existsSync(argument) && path.basename(argument).toLowerCase() === "cua-repl.mjs"),
    browserRuntime,
    chromeNativeHostExists: fs.existsSync(chromeNativeHost),
    chromeNativeHost,
    enabledSurfaces: environment.CUA_REPL_ENABLED_SURFACES,
  };
}
