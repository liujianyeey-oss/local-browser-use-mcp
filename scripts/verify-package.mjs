#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import zlib from "node:zlib";
import {fileURLToPath} from "node:url";
import {runMcpSession} from "../src/mcp-stdio-session.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function walkFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function manifestFiles(manifest) {
  const expected = new Set(["package.json"]);
  for (const pattern of manifest.files ?? []) {
    const source = path.resolve(root, pattern);
    const stat = fs.lstatSync(source);
    if (stat.isDirectory()) {
      for (const file of walkFiles(source)) {
        expected.add(path.relative(root, file).split(path.sep).join("/"));
      }
    } else {
      expected.add(path.relative(root, source).split(path.sep).join("/"));
    }
  }
  return expected;
}

function octalValue(header, start, end) {
  if ((header[start] & 0x80) !== 0) {
    let value = header[start] & 0x7f;
    for (let index = start + 1; index < end; index += 1) {
      value = value * 256 + header[index];
    }
    return value;
  }
  const text = header.toString("ascii", start, end).replace(/\0.*$/, "").trim();
  return text.length === 0 ? 0 : Number.parseInt(text, 8);
}

function tarEntries(archive) {
  const data = zlib.gunzipSync(fs.readFileSync(archive));
  const entries = [];
  let offset = 0;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = octalValue(header, 124, 136);
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const rawName = prefix.length === 0 ? name : `${prefix}/${name}`;
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > data.length) throw new Error("truncated npm archive");
    if (type === "0") {
      const normalized = rawName.replace(/\\/g, "/").replace(/^\.\//, "");
      if (normalized !== "package" && normalized !== "package/") {
        if (!normalized.startsWith("package/")) throw new Error(`unexpected archive path: ${normalized}`);
        entries.push({name: normalized.slice("package/".length), content: data.subarray(contentStart, contentEnd)});
      }
    }
    offset = contentEnd + (512 - (size % 512 || 512));
  }
  if (entries.length === 0) throw new Error("npm archive has no files");
  return entries;
}

function assertAllowedPaths(files) {
  const forbidden = [
    /^test(?:\/.*)?$/,
    /^skills\/control-chrome(?:\/.*)?$/,
    /^skills\/control-in-app-browser(?:\/.*)?$/,
    /^skills\/local-browser-use\/references(?:\/.*)?$/,
    /^\.learnings(?:\/.*)?$/,
    /(?:^|\/)-SMOKE\.json$/,
    /\.tgz$/,
  ];
  for (const file of files) {
    if (forbidden.some((pattern) => pattern.test(file))) {
      throw new Error(`forbidden file in npm archive: ${file}`);
    }
  }
}

function assertNoSensitiveContent(packageDirectory, files) {
  const markers = [
    os.homedir(),
    os.homedir() + path.sep,
    path.resolve(os.homedir(), "..") + path.sep,
    path.resolve(os.tmpdir(), "..") + path.sep,
  ].filter((marker) => path.resolve(marker) !== path.parse(marker).root);
  for (const file of files) {
    const text = fs.readFileSync(path.join(packageDirectory, file), "utf8");
    for (const marker of markers) {
      if (text.includes(marker)) {
        throw new Error(`sensitive content in npm archive ${file}: ${marker}`);
      }
    }
  }
}

function fakeBackendSource() {
  const lineSeparator = String.fromCharCode(10);
  const quote = String.fromCharCode(34);
  const quoted = (value) => quote + value + quote;
  return [
    "import readline from " + quoted("node:readline") + ";",
    "const newLine = String.fromCharCode(10);",
    "const lines = readline.createInterface({input: process.stdin, crlfDelay: Infinity});",
    "for await (const line of lines) {",
    "  if (!line.trim()) continue;",
    "  const message = JSON.parse(line);",
    "  if (message.method === " + quoted("initialize") + " && message.id != null) {",
    "    process.stdout.write(JSON.stringify({jsonrpc: " + quoted("2.0") + ", id: message.id, result: {",
    "      protocolVersion: message.params?.protocolVersion ?? " + quoted("2025-06-18") + ",",
    "      capabilities: {tools: {}, elicitation: {}},",
    "      serverInfo: {name: " + quoted("fake-browser-backend") + ", version: " + quoted("0.0.0") + "},",
    "      instructions: " + quoted("Fake upstream instructions.") + ",",
    "    }}) + newLine);",
    "  } else if (message.method === " + quoted("tools/list") + " && message.id != null) {",
    "    process.stdout.write(JSON.stringify({jsonrpc: " + quoted("2.0") + ", id: message.id, result: {",
    "      tools: [{name: " + quoted("js") + ", inputSchema: {type: " + quoted("object") + "}}],",
    "    }}) + newLine);",
    "  } else if (message.method === " + quoted("tools/call") + " && message.id != null) {",
    "    process.stdout.write(JSON.stringify({jsonrpc: " + quoted("2.0") + ", id: message.id, result: {",
    "      isError: false,",
    "      content: [{type: " + quoted("text") + ", text: " + quoted("fake package e2e state") + "}],",
    "    }}) + newLine);",
    "  }",
    "}",
  ].join(lineSeparator);
}

async function verifyPackagedMcp(packageDirectory, temporaryDirectory) {
  const fakeBackend = path.join(temporaryDirectory, "fake-backend.mjs");
  const configPath = path.join(temporaryDirectory, "fake-config.json");
  fs.writeFileSync(fakeBackend, fakeBackendSource(), {mode: 0o600});
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: {cua_repl: {command: process.execPath, args: [fakeBackend], env: {}}},
  }, null, 2), {mode: 0o600});

  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {name: "local-browser-package-verify", version: "0.0.0"},
    },
  };
  const result = await runMcpSession({
    command: process.execPath,
    args: [path.join(packageDirectory, "bin/local-browser-use-mcp.mjs"), "serve", "--config", configPath],
    env: process.env,
    initialize,
    afterInitialize: [
      {jsonrpc: "2.0", method: "notifications/initialized", params: {}},
      {jsonrpc: "2.0", id: 2, method: "tools/list", params: {}},
      {jsonrpc: "2.0", id: 3, method: "tools/call", params: {
        name: "js", arguments: {code: "await cua.getState()"},
      }},
    ],
    timeoutMs: 15_000,
    closeAfterId: 3,
  });

  if (result.responses.length === 0) {
    throw new Error(`packaged MCP E2E returned no responses: ${JSON.stringify(result)}`);
  }
  assert.equal(result.spawnError, null);
  assert.equal(result.timedOut, false);
  assert.deepEqual(result.responseParseErrors, []);
  const initialized = result.responses.find((response) => response.id === 1);
  const tools = result.responses.find((response) => response.id === 2);
  const toolCall = result.responses.find((response) => response.id === 3);
  if (initialized == null || initialized.error != null || initialized.result?.serverInfo?.name !== "fake-browser-backend") {
    throw new Error(`packaged MCP initialize failed: ${JSON.stringify(initialized)}`);
  }
  assert.match(initialized?.result?.instructions ?? "", /Local Browser Use/);
  if (tools == null || tools.error != null || tools.result?.tools?.some((tool) => tool.name === "js") !== true) {
    throw new Error(`packaged MCP tools/list failed: ${JSON.stringify(tools)}`);
  }
  if (toolCall == null || toolCall.error != null || toolCall.result?.isError !== false) {
    throw new Error(`packaged MCP E2E failed: ${JSON.stringify(toolCall)}`);
  }
  assert.equal(toolCall.result.content?.[0]?.text, "fake package e2e state");
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "local-browser-use-package-"));
try {
  const packed = await execFileAsync(npmCommand, ["pack", "--json", "--pack-destination", temporaryDirectory], {
    cwd: root,
    maxBuffer: 1024 * 1024,
  });
  const metadata = JSON.parse(packed.stdout);
  assert.equal(Array.isArray(metadata), true);
  assert.equal(metadata.length, 1);
  const archive = path.join(temporaryDirectory, metadata[0].filename);
  const entries = tarEntries(archive);
  const files = entries.map((entry) => entry.name).sort();
  assertAllowedPaths(files);

  const packageDirectory = path.join(temporaryDirectory, "package");
  fs.mkdirSync(packageDirectory);
  for (const entry of entries) {
    const destination = path.join(packageDirectory, entry.name);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, entry.content);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
  const expected = [...manifestFiles(manifest)].sort();
  assert.deepEqual(files, expected, "npm archive must exactly match the package files whitelist");
  assertNoSensitiveContent(packageDirectory, files);
  await verifyPackagedMcp(packageDirectory, temporaryDirectory);

  process.stdout.write(`package verification passed: ${metadata[0].filename}, ${files.length} files, fake MCP E2E ok\n`);
} finally {
  fs.rmSync(temporaryDirectory, {recursive: true, force: true});
}
