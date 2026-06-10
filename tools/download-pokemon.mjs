#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath =
  process.argv[2] || path.join(root, "sources", "pokemon-pokeapi.json");

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Wordaroo-Offline-Dictionary/1.0" },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

function languageName(record, language) {
  return record.names.find((name) => name.language.name === language)?.name || "";
}

function generationNumber(record) {
  const match = record.generation?.name?.match(/generation-(i{1,3}|iv|v|vi{0,3}|ix|x)$/);
  if (!match) return "";
  const values = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  return values[match[1]] || "";
}

const list = await fetchJson("https://pokeapi.co/api/v2/pokemon-species?limit=2000");
const records = new Array(list.count);
let nextIndex = 0;

async function worker() {
  while (true) {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= list.results.length) return;
    const species = await fetchJson(list.results[index].url);
    records[index] = {
      id: species.id,
      nameEn: languageName(species, "en"),
      nameZhHant: languageName(species, "zh-hant"),
      generation: generationNumber(species)
    };
    if ((index + 1) % 25 === 0 || index + 1 === list.results.length) {
      process.stdout.write(`Pokémon species: ${index + 1}/${list.results.length}\r`);
    }
  }
}

await Promise.all(Array.from({ length: 20 }, () => worker()));
records.sort((a, b) => a.id - b.id);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  JSON.stringify({
    source: "PokéAPI",
    url: "https://pokeapi.co/",
    accessed: new Date().toISOString().slice(0, 10),
    scope: "National Pokédex species",
    records
  })
);
console.log(`\nSaved ${records.length} Pokémon names to ${outputPath}`);
