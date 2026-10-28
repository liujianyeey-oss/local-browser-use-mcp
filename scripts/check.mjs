#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
function check(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (file.endsWith(".mjs")) {
      const result = spawnSync(process.execPath, ["--check", file], {stdio: "inherit"});
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
for (const directory of ["bin", "src", "scripts", "test"]) check(path.join(root, directory));
