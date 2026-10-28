// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {browserOnlyEnvironment, createApprovalBridge, discoverLiveConfig} from "../src/core.mjs";
import {createTurnMetadataInjector} from "../src/turn-metadata.mjs";
import {createServerInstructionsBridge} from "../src/server-instructions.mjs";

test("browser surface overrides configuration", () => {
  assert.equal(browserOnlyEnvironment({CUA_REPL_ENABLED_SURFACES: "all"}).CUA_REPL_ENABLED_SURFACES, "browser");
});
test("approval fails closed without client elicitation", () => {
  const bridge = createApprovalBridge();
  bridge.handleClient({method: "initialize", params: {capabilities: {}}});
  const result = bridge.handleServer({id: 8, method: "elicitation/create"});
  assert.equal(result.forward, null);
  assert.equal(result.response.result.action, "decline");
});
test("elicitation is forwarded to capable clients", () => {
  const bridge = createApprovalBridge();
  bridge.handleClient({method: "initialize", params: {capabilities: {elicitation: {}}}});
  const request = {id: 8, method: "elicitation/create"};
  assert.deepEqual(bridge.handleServer(request), {forward: request, response: null});
});
test("turn completion advances metadata and enforces session identity", () => {
  const inject = createTurnMetadataInjector({sessionId: "test"});
  const call = (name) => inject({method: "tools/call", params: {name, arguments: {session_id: "other"}}});
  assert.equal(call("turn_ended").params.arguments.session_id, "test");
  const metadata = JSON.parse(call("js").params._meta["x-codex-turn-metadata"]);
  assert.equal(metadata.turn_id, "test-turn-2");
});
test("instructions preserve upstream text and only modify initialize responses", () => {
  const bridge = createServerInstructionsBridge();
  bridge.handleClient({id: 1, method: "initialize"});
  const response = bridge.handleServer({id: 1, result: {instructions: "upstream"}});
  assert.match(response.result.instructions, /^upstream/);
  assert.match(response.result.instructions, /Local Browser Use/);
  const other = {id: 2, result: {}};
  assert.equal(bridge.handleServer(other), other);
});
test("discovery compares numeric versions; explicit invalid config cannot fall back", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-test-"));
  try {
    const root = path.join(home, ".codex/plugins/cache/openai-bundled/unified-computer-use");
    for (const version of ["1.9", "1.10"]) {
      fs.mkdirSync(path.join(root, version), {recursive: true});
      fs.writeFileSync(path.join(root, version, ".mcp.json"), JSON.stringify({
        mcpServers: {cua_repl: {command: process.execPath, args: ["fake"]}},
      }));
    }
    assert.equal(discoverLiveConfig({home}).version, "1.10");
    assert.throws(() => discoverLiveConfig({home, explicitPath: path.join(home, "missing")}), /explicit config/);
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
});
