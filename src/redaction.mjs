// SPDX-License-Identifier: MIT

const HOME_PLACEHOLDER = "<HOME>";
const PATH_PLACEHOLDER = "[REDACTED]";

function normalizeRedaction(redaction = {}) {
  const home = redaction.home ?? process.env.HOME ?? "";
  const paths = Array.isArray(redaction.paths) ? redaction.paths : [];
  return {
    home: typeof home === "string" ? home : "",
    paths: paths.filter((value) => typeof value === "string" && value.length > 0),
  };
}

export function redactText(value, redaction = {}) {
  if (typeof value !== "string") return value;
  const {home, paths} = normalizeRedaction(redaction);
  let output = value;
  if (home) output = output.replaceAll(home, HOME_PLACEHOLDER);
  for (const path of [...paths].sort((a, b) => b.length - a.length)) {
    output = output.replaceAll(path, PATH_PLACEHOLDER);
  }
  return output;
}

export function redactError(error, redaction = {}) {
  if (error == null) return null;
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error?.code === "string" ? " [" + error.code + "]" : "";
  return redactText(name + ": " + message + code, redaction);
}
