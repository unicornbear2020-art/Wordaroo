#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.join(root, "data", "custom", "pixar-characters.json");
const outputPath = path.join(root, "data", "custom", "pixar-characters.js");
const entries = JSON.parse(await readFile(inputPath, "utf8"));

if (!Array.isArray(entries)) {
  throw new Error("pixar-characters.json must contain an array.");
}

await writeFile(
  outputPath,
  `"use strict";\nwindow.WordarooPixarCharacters = ${JSON.stringify(entries)};\n`
);
console.log(`Built ${entries.length} Disney/Pixar character entries.`);
