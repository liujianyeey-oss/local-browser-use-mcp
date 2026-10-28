// SPDX-License-Identifier: MIT
// Allow screenshot responses while bounding complete and unterminated messages.
export const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
export async function* jsonLines(stream, {maxBytes = MAX_MESSAGE_BYTES} = {}) {
  let parts = [];
  let bytes = 0;
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    let start = 0;
    for (;;) {
      const end = chunk.indexOf("\n", start);
      const piece = chunk.slice(start, end < 0 ? undefined : end);
      bytes += Buffer.byteLength(piece);
      if (bytes > maxBytes) throw new Error("JSON-RPC message exceeds size limit");
      if (piece) parts.push(piece);
      if (end < 0) break;
      yield parts.join("").replace(/\r$/, "");
      parts = [];
      bytes = 0;
      start = end + 1;
    }
  }
  if (parts.length) yield parts.join("");
}
