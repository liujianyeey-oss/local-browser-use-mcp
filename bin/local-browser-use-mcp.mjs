#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {
  browserOnlyEnvironment,
  createApprovalBridge,
  loadLiveConfig,
  resolveRuntimeChecks,
} from "../src/core.mjs";
import {
  classifyBackendFailure,
  failureMessage,
  parseObservation,
} from "../src/backend-diagnostics.mjs";
import {redactError, redactText} from "../src/redaction.mjs";
import {createServerInstructionsBridge} from "../src/server-instructions.mjs";
import {runMcpSession} from "../src/mcp-stdio-session.mjs";
import {runMcpRelay} from "../src/stdio-relay.mjs";
import {createTurnMetadataInjector} from "../src/turn-metadata.mjs";
import {randomUUID} from "node:crypto";

const {version} = createRequire(import.meta.url)("../package.json");
const entryPath = fileURLToPath(import.meta.url);
const help = [
  `local-browser-use-mcp ${version}`,
  "",
  "Commands:",
  "  serve [--config PATH]",
  "  doctor [--config PATH] [--online] [--show-paths]",
  "  print-config",
  "  help",
  "",
].join("\n");

function optionsFor(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!allowed.has(argument)) throw new Error(`unknown option: ${argument}`);
    if (argument === "--config") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--config requires a path");
      options.config = value;
      index += 1;
    } else {
      options[argument.slice(2)] = true;
    }
  }
  return options;
}

function load(options = {}) {
  return loadLiveConfig({home: os.homedir(), explicitPath: options.config});
}

async function checkBackend(configPath) {
  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {name: "local-browser-use-doctor", version},
    },
  };
  const code = [
    "const state = await cua.getState({emit: false});",
    "nodeRepl.write(JSON.stringify({",
    "  browserCount: Array.isArray(state.browsers) ? state.browsers.length : 0,",
    "}));",
  ].join("\n");
  const result = await runMcpSession({
    command: process.execPath,
      args: [entryPath, "serve", "--config", configPath],
    env: process.env,
    initialize,
    afterInitialize: [
      {jsonrpc: "2.0", method: "notifications/initialized", params: {}},
      {jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "js", arguments: {code, timeout_ms: 30_000},
      }},
    ],
    timeoutMs: 40_000,
  });
  const toolResponse = result.responses.find((response) => response.id === 2);
  const toolResult = toolResponse?.result;
  const observation = parseObservation(toolResult);
  const browserCount = Number.isInteger(observation?.browserCount) ? observation.browserCount : 0;
  const online = result.spawnError == null && !result.timedOut && result.status === 0 &&
    toolResult?.isError === false && browserCount > 0;
  return {
    online,
    error: online
      ? null
      : classifyBackendFailure({result, toolResult, toolResponse, browserCount}),
  };
}

async function doctor(options) {
  let loaded = null;
  let configurationError = null;
  try {
    loaded = load(options);
  } catch (error) {
    configurationError = error;
  }
  const checks = loaded ? resolveRuntimeChecks(loaded.server, {home: os.homedir()}) : {
    launcherExists: false,
    cuaReplExists: false,
    browserRuntime: null,
    chromeNativeHostExists: false,
    chromeNativeHost: null,
    enabledSurfaces: null,
  };
  const configured = loaded != null;
  const runtimePresent = configured && checks.launcherExists && checks.cuaReplExists &&
    checks.browserRuntime != null;
  let backendOnline = null;
  let backendError = null;
  let backendErrorKind = null;
  let backendErrorDetail = null;
  if (options.online) {
    if (runtimePresent) {
      const backend = await checkBackend(loaded.configPath);
      backendOnline = backend.online;
      backendError = backend.error;
    } else {
      backendOnline = false;
      backendError = {
        kind: "static_runtime_failed",
        detail: "static runtime checks failed",
      };
    }
  }
  backendErrorKind = backendError?.kind ?? null;
  backendErrorDetail = backendError?.detail ?? null;
  backendError = backendError == null ? null : failureMessage(backendError);
  const report = {
    configured,
    runtimePresent,
    backendOnline,
    version: loaded?.version ?? null,
    liveConfig: loaded?.configPath ?? null,
    ...checks,
    error: configurationError == null ? null : redactError(configurationError, {home: ""}),
    backendError,
    backendErrorKind,
    backendErrorDetail,
  };
  const output = JSON.stringify(report, null, 2);
  process.stdout.write(`${options["show-paths"] ? output : redactText(output, {
    home: os.homedir(),
    paths: [checks.browserRuntime, loaded?.configPath].filter(Boolean),
  })}\n`);
  const ready = runtimePresent && (!options.online || backendOnline === true);
  process.exitCode = ready ? 0 : 1;
}

async function serve(options) {
  const {configPath, server} = load(options);
  const injectTurnMetadata = createTurnMetadataInjector({
    sessionId: process.env.LOCAL_BROWSER_USE_SESSION_ID ?? `external-browser-${randomUUID()}`,
  });
  const approvalBridge = createApprovalBridge({
    log: (event) => process.stderr.write(
      `local-browser-use-mcp approval ${JSON.stringify(event)}\n`,
    ),
  });
  const instructions = createServerInstructionsBridge();
  const child = spawn(server.command, server.args, {
    env: {...process.env, ...browserOnlyEnvironment(server.env)},
    stdio: ["pipe", "pipe", "pipe"],
  });
  const home = os.homedir();
  const redaction = {home, paths: [configPath]};
  let stderrBuffer = "";
  const writeStderr = (line) => {
    if (!line.trim()) return;
    const safe = redactText(line, redaction);
    const summary = safe.length > 500 ? `${safe.slice(0, 500)}…` : safe;
    process.stderr.write(`local-browser-use-mcp upstream: ${summary}\n`);
  };
  const consumeStderr = (final = false) => {
    for (;;) {
      const newline = stderrBuffer.indexOf("\n");
      if (newline < 0) break;
      writeStderr(stderrBuffer.slice(0, newline));
      stderrBuffer = stderrBuffer.slice(newline + 1);
    }
    if (stderrBuffer.length > 8192) {
      writeStderr(stderrBuffer.slice(0, 8192));
      stderrBuffer = "";
    }
    if (final && stderrBuffer) {
      writeStderr(stderrBuffer);
      stderrBuffer = "";
    }
  };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
    consumeStderr();
  });
  child.stderr.on("end", () => consumeStderr(true));
  child.stderr.on("error", (error) => {
    process.stderr.write(`local-browser-use-mcp: ${redactError(error, redaction)}\n`);
  });
  process.stdin.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  const result = await runMcpRelay({
    child,
    input: process.stdin,
    output: process.stdout,
    handleClient(message) {
      return injectTurnMetadata(approvalBridge.handleClient(instructions.handleClient(message)));
    },
    handleServer(message) {
      return approvalBridge.handleServer(instructions.handleServer(message));
    },
  });
  consumeStderr(true);
  if (result.error) {
    process.stderr.write(`local-browser-use-mcp: ${redactError(result.error, redaction)}\n`);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exitCode = result.code;
}

async function main() {
  const [command = "serve", ...args] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) {
    process.stdout.write(help);
    return;
  }
  if (command === "doctor") {
    await doctor(optionsFor(args, new Set(["--config", "--online", "--show-paths"])));
    return;
  }
  if (command === "print-config") {
    optionsFor(args, new Set());
    process.stdout.write(`${JSON.stringify({
      command: process.execPath,
      args: [entryPath, "serve"],
    }, null, 2)}\n`);
    return;
  }
  if (command !== "serve") throw new Error(`unknown command: ${command}\n${help}`);
  await serve(optionsFor(args, new Set(["--config"])));
}

try {
  await main();
} catch (error) {
  process.stderr.write(`local-browser-use-mcp: ${redactError(error, {home: os.homedir()})}\n`);
  process.exitCode = 1;
}
