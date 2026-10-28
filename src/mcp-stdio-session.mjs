// SPDX-License-Identifier: MIT
import {spawn} from "node:child_process";
import {jsonLines} from "./json-lines.mjs";
import {createChildShutdown} from "./process-lifecycle.mjs";

// Diagnostic sessions retain bounded output; the live relay streams results.
export function runMcpSession({
  command, args, env, initialize, afterInitialize, timeoutMs,
  closeAfterId = 2, onResponse = () => {}, shutdownGraceMs = 1000,
  maxResponseBytes = 64 * 1024 * 1024, maxStderrBytes = 64 * 1024,
}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {env, stdio: ["pipe", "pipe", "pipe"]});
    const shutdown = createChildShutdown(child, {graceMs: shutdownGraceMs});
    const responses = [];
    const responseParseErrors = [];
    let responseBytes = 0;
    let stderr = "";
    let spawnError = null;
    let timedOut = false;
    let sentFollowup = false;
    let closedInput = false;
    const send = (message) => {
      if (!closedInput && !child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + "\n");
    };
    const closeInput = () => {
      if (closedInput) return;
      closedInput = true;
      if (!child.stdin.destroyed) child.stdin.end();
      shutdown.afterInputClosed();
    };
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") spawnError ??= error;
      shutdown.terminate();
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = Buffer.from(stderr + chunk).subarray(-maxStderrBytes).toString("utf8");
    });
    child.stderr.on("error", (error) => {
      spawnError ??= error;
      shutdown.terminate();
    });
    child.on("error", (error) => { spawnError = error; });
    const timer = setTimeout(() => {
      timedOut = true;
      closeInput();
      shutdown.terminate();
    }, timeoutMs);
    const stdoutDone = (async () => {
      try {
        for await (const line of jsonLines(child.stdout)) {
          if (!line.trim()) continue;
          responseBytes += Buffer.byteLength(line);
          if (responseBytes > maxResponseBytes || responses.length >= 1024) {
            throw new Error("diagnostic response limit exceeded");
          }
          const response = JSON.parse(line);
          if (response == null || typeof response !== "object" || Array.isArray(response)) {
            throw new Error("invalid JSON-RPC response");
          }
          responses.push(response);
          if (response.id === initialize.id && !("error" in response) && !sentFollowup) {
            sentFollowup = true;
            for (const message of afterInitialize) send(message);
          }
          onResponse(response, send);
          if (response.id === closeAfterId) closeInput();
        }
      } catch (error) {
        responseParseErrors.push(error.message);
        shutdown.terminate();
      }
    })();
    child.on("close", async (status, signal) => {
      clearTimeout(timer);
      await stdoutDone;
      shutdown.dispose();
      resolve({status, signal, stderr, responses, responseParseErrors, spawnError, timedOut});
    });
    send(initialize);
  });
}
