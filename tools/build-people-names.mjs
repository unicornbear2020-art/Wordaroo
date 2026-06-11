#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.join(root, "data", "custom", "people-names.json");
const outputPath = path.join(root, "data", "custom", "people-names.js");
const entries = JSON.parse(await readFile(inputPath, "utf8"));

if (!Array.isArray(entries)) {
  throw new Error("people-names.json must contain an array.");
}

await writeFile(
  outputPath,
  `"use strict";\nwindow.WordarooPeopleNames = ${JSON.stringify(entries)};\n`
);
console.log(`Built ${entries.length} people-name entries.`);
