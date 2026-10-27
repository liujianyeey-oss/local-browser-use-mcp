#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import os from "node:os";
import {runMcpSession} from "../src/mcp-stdio-session.mjs";
import {redactText} from "../src/redaction.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridge = path.join(root, "bin/local-browser-use-mcp.mjs");
const outputPath = process.argv[2] == null ? null : path.resolve(process.argv[2]);
const bootstrapCode = "await cua.getState();";
const actionCode = [
  "const before = await cua.listTabs({browser: 'chrome', emit: false});",
  "const tab = await cua.createBrowserTab('chrome', 'https://example.com/', {sessionName: '🧪 Local Browser Smoke'});",
  "let state = null;",
  "let closeAttempted = false;",
  "try {",
  "  state = await tab.getAXState({disableDiffing: true, emit: false});",
  "} finally {",
  "  closeAttempted = true;",
  "  if (typeof tab.close === 'function') await tab.close();",
  "}",
  "const after = await cua.listTabs({browser: 'chrome', emit: false});",
  "nodeRepl.write(JSON.stringify({",
  "  beforeCount: before.length, afterCount: after.length, closeAttempted,",
  "  observedExampleDomain: typeof state === 'string' && /Example Domain/i.test(state),",
  "}));",
].join("\n");
const initialize = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: {
    protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: {name: "local-browser-example-tab-probe", version: "1.0.0"},
  },
};
const result = await runMcpSession({
  command: process.execPath,
  args: [bridge, "serve"],
  env: process.env,
  initialize,
  afterInitialize: [
    {jsonrpc: "2.0", method: "notifications/initialized", params: {}},
    {jsonrpc: "2.0", id: 2, method: "tools/call", params: {
      name: "js", arguments: {code: bootstrapCode, timeout_ms: 30_000},
    }},
  ],
  closeAfterId: 3,
  onResponse(response, send) {
    if (response.id !== 2) return;
    send({jsonrpc: "2.0", id: 3, method: "tools/call", params: {
      name: "js", arguments: {code: actionCode, timeout_ms: 30_000},
    }});
  },
  timeoutMs: 45_000,
});
const toolResult = result.responses.find((response) => response.id === 3)?.result;
let observation = null;
for (const item of toolResult?.content ?? []) {
  if (item.type !== "text" || typeof item.text !== "string") continue;
  try {
    const candidate = JSON.parse(item.text);
    if (typeof candidate?.observedExampleDomain === "boolean") observation = candidate;
  } catch {}
}
const succeeded = result.spawnError == null && !result.timedOut && result.status === 0 &&
  toolResult?.isError === false && observation?.observedExampleDomain === true &&
  observation?.closeAttempted === true && observation?.beforeCount === observation?.afterCount;
const report = {
  observedAt: new Date().toISOString(),
  succeeded,
  scope: "create a temporary Chrome tab for https://example.com, read its AX state, then close it",
  cleanupVerified: observation?.beforeCount === observation?.afterCount,
  process: {
    status: result.status, signal: result.signal, timedOut: result.timedOut,
    spawnError: result.spawnError?.message ?? null,
    stderrSummary: {present: Boolean(result.stderr), length: result.stderr.length},
    responseParseErrors: result.responseParseErrors,
    toolResultIsError: toolResult?.isError ?? null,
    toolTextSummary: {count: (toolResult?.content ?? [])
      .filter((item) => item.type === "text" && typeof item.text === "string").length},
  },
  observation,
};
const safeReport = redactText(JSON.stringify(report, null, 2), {
  home: os.homedir(),
  paths: outputPath ? [outputPath] : [],
});
if (outputPath != null) {
  fs.writeFileSync(outputPath, safeReport + "\n", {mode: 0o600});
  if (fs.existsSync(outputPath)) fs.chmodSync(outputPath, 0o600);
}
if (!succeeded) throw new Error("example tab smoke failed");
process.stdout.write(safeReport + "\n");
