// SPDX-License-Identifier: MIT

import {spawn} from "node:child_process";

export function runMcpSession({
  command, args, env, initialize, afterInitialize, timeoutMs,
  closeAfterId = 2, onResponse = () => {},
}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {env, stdio: ["pipe", "pipe", "pipe"]});
    const responses = [];
    const responseParseErrors = [];
    let stdoutBuffer = "";
    let stderr = "";
    let spawnError = null;
    let timedOut = false;
    let sentFollowup = false;
    let closedInput = false;
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const closeInput = () => {
      if (closedInput) return;
      closedInput = true;
      child.stdin.end();
    };
    const consumeLine = (line) => {
      if (line.length === 0) return;
      try {
        const response = JSON.parse(line);
        responses.push(response);
        if (response.id === initialize.id && !("error" in response) && !sentFollowup) {
          sentFollowup = true;
          for (const message of afterInitialize) send(message);
        }
        onResponse(response, send);
        if (response.id === closeAfterId) closeInput();
      } catch (error) {
        responseParseErrors.push(error instanceof Error ? error.message : String(error));
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        consumeLine(stdoutBuffer.slice(0, newline));
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { spawnError = error; });
    const timer = setTimeout(() => {
      timedOut = true;
      closeInput();
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (stdoutBuffer.length > 0) consumeLine(stdoutBuffer);
      resolve({
        status, signal, stderr, responses, responseParseErrors, spawnError, timedOut,
      });
    });
    send(initialize);
  });
}
