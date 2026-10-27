// SPDX-License-Identifier: MIT

import {once} from "node:events";
import readline from "node:readline";

const writeQueues = new WeakMap();

function epipe() {
  return Object.assign(new Error("stream closed"), {code: "EPIPE"});
}

function write(stream, text) {
  const previous = writeQueues.get(stream) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    if (stream.destroyed || stream.writableEnded) throw epipe();
    if (!stream.write(text)) await once(stream, "drain");
  });
  writeQueues.set(stream, next);
  return next;
}

function parse(line) {
  try {
    const message = JSON.parse(line);
    if (message == null || typeof message !== "object" || Array.isArray(message)) {
      return {invalidRequest: true};
    }
    return {message};
  } catch {
    return {parseError: true};
  }
}

export async function runMcpRelay({
  child,
  input,
  output,
  handleClient,
  handleServer,
  signalProcess = process,
}) {
  const clientLines = readline.createInterface({input, crlfDelay: Infinity});
  const serverLines = readline.createInterface({input: child.stdout, crlfDelay: Infinity});
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  let failure = null;
  let outputLost = false;
  let receivedSignal = null;
  let exit = {code: 1, signal: null};

  const stop = (error) => {
    failure ??= error;
    input.destroy();
    clientLines.close();
    if (child.exitCode == null && child.signalCode == null && !child.killed) {
      child.kill("SIGTERM");
    }
  };
  const onOutputError = (error) => {
    if (error?.code !== "EPIPE") {
      stop(error);
      return;
    }
    outputLost = true;
    input.destroy();
    clientLines.close();
    if (child.exitCode == null && child.signalCode == null && !child.killed) {
      child.kill("SIGTERM");
    }
  };
  const onInputError = (error) => stop(error);
  const onChildInputError = (error) => {
    if (error?.code !== "EPIPE") stop(error);
  };
  const onChildOutputError = (error) => stop(error);
  const onChildError = (error) => {
    failure ??= error;
  };
  const signalHandlers = new Map();
  for (const signal of signals) {
    const handler = () => {
      if (receivedSignal != null) return;
      receivedSignal = signal;
      if (child.exitCode == null && child.signalCode == null) child.kill(signal);
    };
    signalHandlers.set(signal, handler);
    signalProcess.on(signal, handler);
  }

  output.on("error", onOutputError);
  input.on("error", onInputError);
  child.stdin.on("error", onChildInputError);
  child.stdout.on("error", onChildOutputError);
  child.on("error", onChildError);

  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      exit = {code, signal};
      input.destroy();
      clientLines.close();
      resolve();
    });
  });

  const pumpClient = async () => {
    try {
      for await (const line of clientLines) {
        if (!line.trim()) continue;
        const parsed = parse(line);
        if (parsed.parseError) {
          await write(output, `${JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: {code: -32700, message: "Parse error"},
          })}\n`);
          continue;
        }
        if (parsed.invalidRequest) {
          await write(output, `${JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: {code: -32600, message: "Invalid Request"},
          })}\n`);
          continue;
        }
        const message = handleClient(parsed.message);
        if (message != null) await write(child.stdin, `${JSON.stringify(message)}\n`);
      }
      if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
    } catch (error) {
      if (error?.code === "EPIPE") {
        if (output.destroyed || outputLost) onOutputError(error);
        else if (child.exitCode == null && child.signalCode == null) stop(error);
      } else if (!outputLost) {
        stop(error);
      }
    }
  };

  const pumpServer = async () => {
    try {
      for await (const line of serverLines) {
        if (!line.trim()) continue;
        const parsed = parse(line);
        if (parsed.parseError || parsed.invalidRequest) {
          stop(new Error("upstream produced invalid JSON-RPC over stdio"));
          break;
        }
        const result = handleServer(parsed.message);
        if (result?.response != null) {
          await write(child.stdin, `${JSON.stringify(result.response)}\n`);
        }
        if (result?.forward != null) {
          await write(output, `${JSON.stringify(result.forward)}\n`);
        }
      }
    } catch (error) {
      if (error?.code === "EPIPE") onOutputError(error);
      else if (!outputLost) stop(error);
    }
  };

  try {
    await Promise.all([pumpClient(), pumpServer(), closed]);
    if (!outputLost && !output.destroyed && !output.writableEnded) output.end();
    return {
      code: failure ? 1 : outputLost ? 0 : exit.code ?? 1,
      signal: failure || outputLost ? null : exit.signal,
      error: failure,
    };
  } finally {
    for (const [signal, handler] of signalHandlers) {
      signalProcess.removeListener(signal, handler);
    }
    output.removeListener("error", onOutputError);
    input.removeListener("error", onInputError);
    child.stdin.removeListener("error", onChildInputError);
    child.stdout.removeListener("error", onChildOutputError);
    child.removeListener("error", onChildError);
    clientLines.close();
    serverLines.close();
  }
}
