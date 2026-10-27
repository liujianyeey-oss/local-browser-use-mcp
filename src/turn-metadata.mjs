// SPDX-License-Identifier: MIT

export function createTurnMetadataInjector({ sessionId, model = "external-mcp-client" }) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new TypeError("sessionId must be a non-empty string");
  }
  let turnCounter = 1;
  const currentTurnId = () => `${sessionId}-turn-${turnCounter}`;
  return (message) => {
    if (message?.method !== "tools/call" || message?.params == null) return message;
    const existingMeta = message.params._meta;
    const meta = existingMeta != null && typeof existingMeta === "object" && !Array.isArray(existingMeta)
      ? existingMeta : {};
    const turnId = currentTurnId();
    const isTurnEnded = message.params.name === "turn_ended";
    const rewritten = {
      ...message,
      params: {
        ...message.params,
        ...(isTurnEnded ? { arguments: {
          hook_event_name: "Stop",
          ...(message.params.arguments ?? {}),
          session_id: sessionId,
          turn_id: turnId,
        } } : {}),
        _meta: { ...meta, "x-codex-turn-metadata": JSON.stringify({
          session_id: sessionId, turn_id: turnId, model, thread_source: "external_mcp",
        }) },
      },
    };
    if (isTurnEnded) turnCounter += 1;
    return rewritten;
  };
}
