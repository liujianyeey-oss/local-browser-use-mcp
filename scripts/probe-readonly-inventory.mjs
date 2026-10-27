#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import os from "node:os";
import {
  classifyBackendFailure,
  parseObservation,
} from "../src/backend-diagnostics.mjs";
import {runMcpSession} from "../src/mcp-stdio-session.mjs";
import {redactText} from "../src/redaction.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridge = path.join(root, "bin/local-browser-use-mcp.mjs");
const outputPath = process.argv[2] == null ? null : path.resolve(process.argv[2]);
const code = [
  "const state = await cua.getState({emit: false});",
  "nodeRepl.write(JSON.stringify({",
  "  nativeAppCount: Array.isArray(state.apps) ? state.apps.length : null,",
  "  browsers: state.browsers.map((browser) => ({",
  "    id: browser.id, type: browser.type ?? null, family: browser.family ?? null,",
  "    tabCount: Array.isArray(browser.tabs) ? browser.tabs.length : 0,",
  "  })),",
  "  errors: state.errors ?? [],",
  "}));",
].join("\n");
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: {name: "local-browser-readonly-probe", version: "1.0.0"},
  },
};
const result = await runMcpSession({
  command: process.execPath,
  args: [bridge, "serve"],
  env: process.env,
  initialize,
  afterInitialize: [
    {jsonrpc: "2.0", method: "notifications/initialized", params: {}},
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {name: "js", arguments: {code, timeout_ms: 30_000}},
    },
  ],
  timeoutMs: 45_000,
});
const toolResult = result.responses.find((response) => response.id === 2)?.result;
const observation = parseObservation(toolResult);
const inventory = Array.isArray(observation?.browsers) ? observation : null;
const succeeded = result.spawnError == null &&
  !result.timedOut &&
  result.status === 0 &&
  toolResult?.isError === false &&
  inventory != null;
const report = {
  observedAt: new Date().toISOString(),
  succeeded,
  scope: "one read-only cua.getState call through local-browser-use-mcp",
  sideEffectBoundary: [
    "Does not read tab titles, URLs, DOM, accessibility state, screenshots, cookies, or storage.",
    "Does not claim, create, navigate, click, type, upload, download, or modify a tab.",
  ],
  process: {
    status: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    spawnError: result.spawnError?.message ?? null,
    stderrSummary: {
      present: Boolean(result.stderr),
      length: result.stderr.length,
    },
    responseParseErrors: result.responseParseErrors,
  },
  inventory,
};
const failure = succeeded
  ? null
  : classifyBackendFailure({result, toolResult, browserCount: inventory?.browsers.length ?? 0});
if (failure != null) report.failure = failure;
const safeReport = redactText(JSON.stringify(report, null, 2), {
  home: os.homedir(),
  paths: outputPath ? [outputPath] : [],
});
if (outputPath != null) {
  fs.writeFileSync(outputPath, safeReport + "\n", {mode: 0o600});
  if (fs.existsSync(outputPath)) fs.chmodSync(outputPath, 0o600);
}
process.stdout.write(safeReport + "\n");
if (!succeeded) process.exitCode = 1;
