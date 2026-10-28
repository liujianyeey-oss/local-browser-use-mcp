// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {Readable} from "node:stream";
import {runMcpSession} from "../src/mcp-stdio-session.mjs";
import {jsonLines} from "../src/json-lines.mjs";
const initialize = {jsonrpc: "2.0", id: 1, method: "initialize"};
const run = (code, options = {}) => runMcpSession({
  command: process.execPath, args: ["--input-type=module", "-e", code],
  env: process.env, initialize, afterInitialize: [], timeoutMs: 1500, shutdownGraceMs: 100,
  ...options,
});
test("line decoder preserves split unicode and accepts multiple lines", async () => {
  const bytes = Buffer.from('{"value":"中"}\r\n{}\n');
  const lines = [];
  for await (const line of jsonLines(Readable.from([bytes.subarray(0, 12), bytes.subarray(12)]))) lines.push(line);
  assert.deepEqual(lines, ['{"value":"中"}', '{}']);
});
test("line decoder bounds complete and unterminated messages", async () => {
  for (const suffix of ["", "\n"]) {
    await assert.rejects(async () => {
      for await (const line of jsonLines(Readable.from(["12345" + suffix]), {maxBytes: 4})) void line;
    }, /size limit/);
  }
});
test("timeout kills a backend ignoring SIGTERM", {timeout: 5000}, async () => {
  const result = await run('process.on("SIGTERM", () => {}); process.stdin.resume(); setInterval(() => {}, 1000);', {timeoutMs: 500});
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGKILL");
});
test("successful response closes input and kills backend that refuses to exit", {timeout: 5000}, async () => {
  const result = await run('process.on("SIGTERM", () => {}); process.stdin.resume(); console.log(JSON.stringify({id:2,result:{}})); setInterval(() => {}, 1000);');
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.responses[0].id, 2);
});
test("missing executable returns a spawn error instead of crashing", async () => {
  const result = await run("", {command: "/nonexistent/local-browser-test"});
  assert.equal(result.spawnError.code, "ENOENT");
});
test("malformed output terminates session", async () => {
  const result = await run('console.log("invalid"); setInterval(() => {}, 1000);');
  assert.equal(result.responseParseErrors.length, 1);
});
test("diagnostic retention limits responses and stderr", async () => {
  const result = await run('process.stderr.write("x".repeat(10000)); console.log(JSON.stringify({id:7,result:"x".repeat(1000)})); setInterval(() => {}, 1000);', {maxResponseBytes: 100, maxStderrBytes: 64});
  assert.equal(result.responses.length, 0);
  assert.match(result.responseParseErrors[0], /limit/);
  assert.ok(Buffer.byteLength(result.stderr) <= 64);
});
