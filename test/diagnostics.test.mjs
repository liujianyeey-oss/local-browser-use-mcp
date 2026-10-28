// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {classifyBackendFailure} from "../src/backend-diagnostics.mjs";
const cli = fileURLToPath(new URL("../bin/local-browser-use-mcp.mjs", import.meta.url));
test("JSON-RPC errors retain their error code", () => {
  assert.deepEqual(classifyBackendFailure({
    result: {responseParseErrors: []},
    toolResponse: {error: {code: -32601, message: "private detail"}},
  }), {kind: "tool_error", detail: "the read-only tool call was rejected (JSON-RPC -32601)"});
});
test("doctor hides paths by default and reveals them only on request", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bridge paths 中文 "));
  const config = path.join(directory, "config.json");
  fs.writeFileSync(config, JSON.stringify({mcpServers: {cua_repl: {
    command: process.execPath, args: ["missing-cua-repl.mjs"],
  }}}));
  try {
    const run = (args) => spawnSync(process.execPath, [cli, "doctor", "--config", config, ...args], {encoding: "utf8"});
    const hidden = run([]);
    const visible = run(["--show-paths"]);
    assert.equal(hidden.status, 1);
    assert.equal(JSON.parse(hidden.stdout).liveConfig, "[REDACTED]");
    assert.equal(JSON.parse(visible.stdout).liveConfig, config);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
