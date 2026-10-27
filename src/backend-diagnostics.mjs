// SPDX-License-Identifier: MIT

const KERNEL_FAILURE = "node_repl kernel failed";

export function textItems(toolResult) {
  return (toolResult?.content ?? []).filter((item) =>
    item?.type === "text" && typeof item.text === "string"
  );
}

export function parseObservation(toolResult) {
  for (const item of textItems(toolResult)) {
    try {
      const candidate = JSON.parse(item.text);
      if (candidate != null && typeof candidate === "object" && !Array.isArray(candidate)) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

export function classifyBackendFailure({result, toolResult, browserCount = 0}) {
  if (result.spawnError != null) {
    return {kind: "spawn_error", detail: "the configured backend process could not start"};
  }
  if (result.timedOut) {
    return {kind: "timeout", detail: "the read-only backend check timed out"};
  }
  if (result.responseParseErrors.length > 0) {
    return {kind: "protocol_error", detail: "the backend returned invalid JSON-RPC output"};
  }
  if (toolResult == null) {
    return {kind: "protocol_error", detail: "the backend did not return the read-only tool result"};
  }
  if (toolResult.error != null) {
    const code = typeof toolResult.error?.code === "number"
      ? ` (JSON-RPC ${toolResult.error.code})`
      : "";
    return {kind: "tool_error", detail: `the read-only tool call was rejected${code}`};
  }
  if (toolResult.isError === true) {
    const text = textItems(toolResult).map((item) => item.text).join("\n");
    const kernelFailed = /node_repl kernel exited unexpectedly|kernel_status\s*:\s*"exited\(/i.test(text);
    const sandboxRestricted = /sandbox_apply:\s*Operation not permitted|Operation not permitted \(os error 1\)/i.test(text);
    if (kernelFailed) {
      return {
        kind: "runtime_kernel_failed",
        detail: sandboxRestricted
          ? "the Runtime node_repl kernel exited because sandbox creation was denied"
          : "the Runtime node_repl kernel exited unexpectedly",
        sandboxRestricted,
      };
    }
    return {kind: "tool_error", detail: "the read-only cua.getState call failed"};
  }
  if (result.status !== 0) {
    return {kind: "process_exit", detail: `the backend bridge exited with status ${result.status ?? "unknown"}`};
  }
  if (browserCount === 0) {
    return {kind: "no_browser_backend", detail: "no browser backend is connected"};
  }
  return {kind: "check_failed", detail: "the read-only backend check failed"};
}

export function failureMessage(failure) {
  if (failure?.kind === "runtime_kernel_failed") return KERNEL_FAILURE;
  return failure?.detail ?? "read-only backend check failed";
}
