// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {PassThrough} from "node:stream";
import {EventEmitter, once} from "node:events";
import {runMcpRelay} from "../src/stdio-relay.mjs";
function setup(code) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {stdio: ["pipe", "pipe", "pipe"]});
  const input = new PassThrough();
  const output = new PassThrough();
  const signalProcess = new EventEmitter();
  let text = "";
  output.on("data", (chunk) => { text += chunk; });
  const done = runMcpRelay({
    child, input, output, signalProcess, shutdownGraceMs: 100,
    handleClient: (message) => message,
    handleServer: (message) => ({forward: message}),
  });
  return {child, input, output, signalProcess, done, text: () => text};
}
test("relay forwards valid messages and reports invalid client JSON", {timeout: 5000}, async () => {
  const relay = setup('import readline from "node:readline"; for await (const line of readline.createInterface({input:process.stdin})) console.log(line);');
  relay.input.end('oops\n[]\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  const result = await relay.done;
  assert.equal(result.code, 0);
  const messages = relay.text().trim().split("\n").map(JSON.parse);
  assert.deepEqual(messages.map((m) => m.error?.code ?? m.id), [-32700, -32600, 1]);
});
test("invalid upstream output fails closed and kills an unresponsive backend", {timeout: 5000}, async () => {
  const relay = setup('process.on("SIGTERM",()=>{}); console.log("not json"); setInterval(()=>{},1000);');
  const result = await relay.done;
  assert.equal(result.code, 1);
  assert.match(result.error.message, /invalid JSON-RPC/);
  assert.equal(relay.child.signalCode, "SIGKILL");
  assert.equal(relay.text(), "");
});
test("client EOF cleans up a backend that ignores EOF", {timeout: 5000}, async () => {
  const relay = setup('process.stdin.resume(); setInterval(()=>{},1000);');
  relay.input.end();
  await relay.done;
  assert.equal(relay.child.signalCode, "SIGKILL");
});
test("signal handlers are removed after shutdown", {timeout: 5000}, async () => {
  const relay = setup('process.stdin.resume(); setInterval(()=>{},1000);');
  await once(relay.child, "spawn");
  relay.signalProcess.emit("SIGTERM");
  await relay.done;
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) assert.equal(relay.signalProcess.listenerCount(signal), 0);
});
test("missing backend executable is reported without hanging", {timeout: 5000}, async () => {
  const child = spawn("/nonexistent/bridge-relay-test", [], {stdio: ["pipe", "pipe", "pipe"]});
  const result = await runMcpRelay({
    child, input: new PassThrough(), output: new PassThrough(),
    signalProcess: new EventEmitter(),
    handleClient: (m) => m, handleServer: (m) => ({forward: m}),
  });
  assert.equal(result.code, 1);
  assert.equal(result.error.code, "ENOENT");
});
