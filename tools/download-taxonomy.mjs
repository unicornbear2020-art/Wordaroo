#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = process.argv[2] || path.join(root, "sources");

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Wordaroo-Offline-Dictionary/1.0" },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function downloadDinosaurs() {
  const records = [];
  const limit = 5000;
  for (let offset = 0; ; offset += limit) {
    const url =
      "https://paleobiodb.org/data1.2/taxa/list.json" +
      `?base_name=Dinosauria&rel=all_children&show=attr&limit=${limit}&offset=${offset}`;
    const page = await fetchJson(url);
    records.push(...(page.records || []));
    process.stdout.write(`PBDB Dinosauria: ${records.length}\r`);
    if (!page.records || page.records.length < limit) break;
  }

  const aves = records.find((record) => record.nam === "Aves");
  const excluded = new Set(aves ? [aves.oid] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (!excluded.has(record.oid) && excluded.has(record.par)) {
        excluded.add(record.oid);
        changed = true;
      }
    }
  }

  const names = records
    .filter((record) => !excluded.has(record.oid))
    .filter((record) => record.nam && /[A-Za-z]/.test(record.nam))
    .map((record) => ({
      id: record.oid,
      name: record.nam,
      rank: record.rnk || "taxon",
      parentId: record.par || "",
      attribution: record.att || "",
      extinct: record.ext === "0"
    }));
  console.log(`\nPBDB non-avian Dinosauria names: ${names.length}`);
  return names;
}

async function downloadMosses() {
  const records = [];
  const seen = new Set([35]);
  const queue = [35];
  const concurrency = 10;
  let active = 0;

  async function childrenFor(key) {
    const children = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await fetchJson(
        `https://api.gbif.org/v1/species/${key}/children?limit=1000&offset=${offset}`
      );
      children.push(...page.results);
      if (page.endOfRecords || page.results.length < 1000) break;
    }
    return children;
  }

  async function worker() {
    while (true) {
      const key = queue.shift();
      if (key === undefined) {
        if (active === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      active += 1;
      const children = await childrenFor(key);
      for (const record of children) {
        if (seen.has(record.key)) continue;
        seen.add(record.key);
        if (record.taxonomicStatus === "ACCEPTED") records.push(record);
        if (record.numDescendants > 0) queue.push(record.key);
      }
      active -= 1;
      process.stdout.write(`GBIF accepted Bryophyta: ${records.length}\r`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const names = records
    .filter((record) => record.scientificName && /[A-Za-z]/.test(record.scientificName))
    .map((record) => ({
      key: record.key,
      name: record.scientificName,
      canonicalName: record.canonicalName || record.scientificName,
      rank: record.rank || "TAXON",
      status: record.taxonomicStatus || "",
      parent: record.parent || "",
      accepted: record.accepted || "",
      authorship: record.authorship || "",
      synonym: false
    }));
  console.log(`\nGBIF Bryophyta names: ${names.length}`);
  return names;
}

await mkdir(outputDir, { recursive: true });
const [dinosaurs, mosses] = await Promise.all([downloadDinosaurs(), downloadMosses()]);
await writeFile(
  path.join(outputDir, "dinosaurs-pbdb.json"),
  JSON.stringify({
    source: "Paleobiology Database",
    accessed: new Date().toISOString().slice(0, 10),
    root: "Dinosauria",
    excludes: "Aves and descendants",
    records: dinosaurs
  })
);
await writeFile(
  path.join(outputDir, "mosses-gbif.json"),
  JSON.stringify({
    source: "GBIF Backbone Taxonomy",
    doi: "10.15468/39omei",
    license: "CC BY 4.0",
    accessed: new Date().toISOString().slice(0, 10),
    root: "Bryophyta",
    records: mosses
  })
);
console.log(`Saved taxonomy sources to ${outputDir}`);
