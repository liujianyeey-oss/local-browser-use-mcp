#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const files = fs.readdirSync(new URL("../test/", import.meta.url))
  .filter((name) => name.endsWith(".test.mjs")).sort();
if (!files.length) throw new Error("No test files found");
const result = spawnSync(process.execPath, ["--test", ...files.map((name) => "test/" + name)], {
  cwd: root, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
