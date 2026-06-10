#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "data");
const shardDir = path.join(outputDir, "shards");
const customEntriesPath = path.join(root, "custom-entries.json");
const inputPath = process.argv[2];
const legacyHtml = process.argv[3];
const ecdictPath = process.argv[4];
const bilingualSentencesPath = process.argv[5];
const dinosaurPath = process.argv[6];
const mossPath = process.argv[7];
const require = createRequire(import.meta.url);
const OpenCC = require("./vendor/opencc-cn2t.cjs");
const toTraditional = OpenCC.Converter({ from: "cn", to: "hk" });

if (!inputPath) {
  console.error(
    "Usage: node tools/build-dictionary.mjs <wiktextract.jsonl[.gz]> " +
    "[legacy-wordaroo.html] [ecdict.csv] [tatoeba-cmn.txt] " +
    "[dinosaurs-pbdb.json] [mosses-gbif.json]"
  );
  process.exit(1);
}

function normalise(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
}

function shardKey(word) {
  const key = normalise(word).replace(/^[^a-z0-9]+/, "");
  if (!key) return "__";
  return `${key}___`.slice(0, 3).replace(/[^a-z0-9]/g, "_");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectRegions(record) {
  const text = JSON.stringify({
    categories: record.categories,
    tags: record.tags,
    raw_tags: record.raw_tags,
    senses: record.senses?.map((sense) => ({
      categories: sense.categories,
      tags: sense.tags,
      raw_tags: sense.raw_tags
    }))
  }).toLowerCase();
  const regions = [];
  if (/\b(british|uk|united kingdom)\b/.test(text)) regions.push("UK");
  if (/\b(american|us|usa|united states)\b/.test(text)) regions.push("US");
  if (/\b(australian|australia)\b/.test(text)) regions.push("AU");
  return regions;
}

function collectPronunciations(record) {
  const result = { UK: [], US: [], AU: [], OTHER: [] };
  for (const sound of record.sounds || []) {
    if (!sound.ipa) continue;
    const tags = [...(sound.tags || []), ...(sound.raw_tags || [])].join(" ").toLowerCase();
    let region = "OTHER";
    if (/\b(uk|british)\b/.test(tags)) region = "UK";
    else if (/\b(us|usa|american)\b/.test(tags)) region = "US";
    else if (/\b(au|australian)\b/.test(tags)) region = "AU";
    result[region].push(sound.ipa);
  }
  Object.keys(result).forEach((key) => {
    result[key] = unique(result[key]).slice(0, 4);
  });
  return result;
}

function mapSense(sense) {
  const gloss = sense.glosses?.[0] || sense.raw_glosses?.[0];
  if (!gloss) return null;
  return {
    gloss,
    glossZh: "",
    labels: unique([...(sense.tags || []), ...(sense.raw_tags || [])]).slice(0, 8),
    examples: unique((sense.examples || []).map((example) => example.text))
      .slice(0, 3)
      .map((text) => ({ en: text, zh: "" }))
  };
}

function mapRecord(record) {
  const senses = (record.senses || []).map(mapSense).filter(Boolean);
  if (!record.word || !senses.length) return null;
  return {
    word: record.word,
    regions: collectRegions(record),
    pronunciations: collectPronunciations(record),
    meanings: [{ pos: record.pos || "word", senses }],
    forms: (record.forms || [])
      .filter((form) => form.form && normalise(form.form) !== normalise(record.word))
      .map((form) => ({
        form: form.form,
        tags: unique([...(form.tags || []), ...(form.raw_tags || [])]).slice(0, 4)
      }))
      .slice(0, 30),
    source: "wiktionary"
  };
}

function mergeEntry(target, incoming) {
  target.regions = unique([...target.regions, ...incoming.regions]);
  for (const region of ["UK", "US", "AU", "OTHER"]) {
    target.pronunciations[region] = unique([
      ...target.pronunciations[region],
      ...incoming.pronunciations[region]
    ]).slice(0, 4);
  }
  target.meanings.push(...incoming.meanings);
  target.forms = uniqueBy(
    [...target.forms, ...incoming.forms],
    (form) => `${normalise(form.form)}:${form.tags.join(",")}`
  ).slice(0, 40);
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const taxonomyRankZh = {
  clade: "演化支",
  "unranked clade": "未定階演化支",
  order: "目",
  suborder: "亞目",
  infraorder: "下目",
  superfamily: "總科",
  family: "科",
  subfamily: "亞科",
  tribe: "族",
  genus: "屬",
  subgenus: "亞屬",
  species: "種",
  subspecies: "亞種",
  phylum: "門",
  class: "綱",
  subclass: "亞綱",
  taxon: "分類群"
};

function taxonomyEntry({
  word,
  translation,
  gloss,
  glossZh,
  rank,
  labels,
  source
}) {
  return {
    word,
    translation,
    regions: [],
    pronunciations: { UK: [], US: [], AU: [], OTHER: [] },
    meanings: [{
      pos: rank || "scientific name",
      senses: [{
        gloss,
        glossZh,
        labels,
        examples: []
      }]
    }],
    forms: [],
    source
  };
}

async function addTaxonomyEntries(entries, dinosaurJsonPath, mossJsonPath) {
  let dinosaurAdded = 0;
  let mossAdded = 0;

  if (dinosaurJsonPath) {
    const data = JSON.parse(await readFile(dinosaurJsonPath, "utf8"));
    const parentNames = new Map(data.records.map((record) => [record.id, record.name]));
    for (const record of data.records) {
      const key = normalise(record.name);
      if (!key || entries.has(key)) continue;
      const rank = String(record.rank || "taxon").toLowerCase();
      const rankZh = taxonomyRankZh[rank] || "分類群";
      const parent = parentNames.get(record.parentId) || "Dinosauria";
      entries.set(key, taxonomyEntry({
        word: record.name,
        translation: `恐龍${rankZh}學名：${record.name}`,
        gloss:
          `${record.name} is a ${rank} classified within non-avian Dinosauria` +
          (parent ? ` under ${parent}.` : "."),
        glossZh:
          `${record.name} 是非鳥類恐龍中的${rankZh}學名` +
          (parent ? `，上級分類為 ${parent}。` : "。"),
        rank: `${rank} · dinosaur taxonomy`,
        labels: ["scientific name", "dinosaur", "palaeontology", rank],
        source: "pbdb"
      }));
      dinosaurAdded += 1;
    }
  }

  if (mossJsonPath) {
    const data = JSON.parse(await readFile(mossJsonPath, "utf8"));
    for (const record of data.records) {
      const key = normalise(record.name);
      if (!key || entries.has(key)) continue;
      const rank = String(record.rank || "taxon").toLowerCase();
      const rankZh = taxonomyRankZh[rank] || "分類群";
      const parent = record.parent || "Bryophyta";
      const status = record.synonym ? "a synonym" : "an accepted name";
      entries.set(key, taxonomyEntry({
        word: record.name,
        translation: `苔蘚植物${rankZh}學名：${record.canonicalName}`,
        gloss:
          `${record.name} is ${status} for a ${rank} in the moss phylum Bryophyta` +
          (parent ? ` under ${parent}.` : "."),
        glossZh:
          `${record.name} 是苔蘚植物門 Bryophyta 中的${rankZh}` +
          (record.synonym ? "異名" : "學名") +
          (parent ? `，上級分類為 ${parent}。` : "。"),
        rank: `${rank} · moss taxonomy`,
        labels: ["scientific name", "moss", "Bryophyta", "botany", status, rank],
        source: "gbif"
      }));
      mossAdded += 1;
    }
  }

  return { dinosaurAdded, mossAdded };
}

async function readLegacyEntries(htmlPath) {
  if (!htmlPath) return [];
  const html = await readFile(htmlPath, "utf8");
  const match = html.match(
    /<script type="application\/json" id="lexiconData">([\s\S]*?)<\/script>/
  );
  if (!match) return [];
  return JSON.parse(match[1]).map((entry) => {
    const regionText = `${entry.category} ${entry.type} ${(entry.tags || []).join(" ")}`.toLowerCase();
    const regions = [];
    if (regionText.includes("british")) regions.push("UK");
    if (regionText.includes("american")) regions.push("US");
    if (regionText.includes("australian")) regions.push("AU");
    const pronunciationRegion = regions.includes("AU") ? "AU" : regions.includes("US") ? "US" : "UK";
    return {
      word: entry.word,
      translation: entry.translation || "",
      regions,
      pronunciations: {
        UK: pronunciationRegion === "UK" && entry.phonetic ? [entry.phonetic] : [],
        US: pronunciationRegion === "US" && entry.phonetic ? [entry.phonetic] : [],
        AU: pronunciationRegion === "AU" && entry.phonetic ? [entry.phonetic] : [],
        OTHER: []
      },
      meanings: [{
        pos: entry.type || "word",
        senses: [{
          gloss: entry.definition || entry.definitionTranslation || entry.translation,
          glossZh: entry.definitionTranslation || entry.translation || "",
          labels: entry.tags || [],
          examples: (entry.examples || [])
            .filter((example) => example.en)
            .map((example) => ({ en: example.en, zh: example.zh || "" }))
        }]
      }],
      forms: [],
      source: "wordaroo"
    };
  });
}

async function readCustomEntries() {
  try {
    const entries = JSON.parse(await readFile(customEntriesPath, "utf8"));
    return entries.map((entry) => ({ ...entry, source: "wordaroo" }));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function* parseCsv(text) {
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      yield row;
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    yield row;
  }
}

async function applyChineseTranslations(entries, csvPath) {
  if (!csvPath) return { translated: 0, added: 0 };
  const rows = parseCsv(await readFile(csvPath, "utf8"));
  const wanted = new Set(entries.keys());
  for (const entry of entries.values()) {
    for (const form of entry.forms || []) wanted.add(normalise(form.form));
  }
  const translations = new Map();
  let added = 0;
  let firstRow = true;
  for (const row of rows) {
    if (firstRow) {
      firstRow = false;
      continue;
    }
    const key = normalise(row[0]);
    if (!key || !row[3]) continue;
    const translation = toTraditional(row[3].trim())
      .replace(/\\n/g, "\n")
      .split("\n")
      .filter((line) => !/^\[(網絡|網路)\]/.test(line.trim()))
      .join("\n")
      .trim();
    if (!translation) continue;
    if (wanted.has(key)) translations.set(key, translation);

    if (
      !entries.has(key) &&
      /^[a-z][a-z0-9' .-]{0,79}$/i.test(String(row[0]).trim())
    ) {
      const definition = String(row[2] || "")
        .replace(/\\n/g, "\n")
        .trim();
      const phonetic = String(row[1] || "").trim();
      const pos = String(row[4] || "word")
        .split(/[,:/]/)[0]
        .trim() || "word";
      entries.set(key, {
        word: String(row[0]).trim(),
        translation,
        regions: [],
        pronunciations: {
          UK: [],
          US: [],
          AU: [],
          OTHER: phonetic ? [`/${phonetic.replace(/^\/|\/$/g, "")}/`] : []
        },
        meanings: [{
          pos,
          senses: [{
            gloss: definition || "English vocabulary entry.",
            glossZh: "",
            labels: [],
            examples: []
          }]
        }],
        forms: [],
        source: "ecdict"
      });
      added += 1;
    }
  }
  let translated = 0;
  for (const [key, entry] of entries) {
    if (entry.translation) {
      translated += 1;
      continue;
    }
    const direct = translations.get(key);
    const inherited = (entry.forms || [])
      .map((form) => translations.get(normalise(form.form)))
      .find(Boolean);
    entry.translation = direct || inherited || "";
    if (entry.translation) translated += 1;
  }
  return { translated, added };
}

async function applyBilingualExamples(entries, sentencePath) {
  if (!sentencePath) return 0;
  const pairs = new Map();
  const pairsByWord = new Map();
  const lines = createInterface({
    input: createReadStream(sentencePath),
    crlfDelay: Infinity
  });
  for await (const line of lines) {
    const [english, chinese] = line.split("\t");
    if (!english || !chinese) continue;
    const key = normalise(english);
    const pair = { en: english, zh: toTraditional(chinese) };
    if (!pairs.has(key)) pairs.set(key, pair.zh);
    const words = unique(key.match(/[a-z]+(?:['-][a-z]+)*/g) || []);
    for (const word of words) {
      if (!pairsByWord.has(word)) pairsByWord.set(word, []);
      const candidates = pairsByWord.get(word);
      if (candidates.length < 3 && !candidates.some((candidate) => candidate.en === pair.en)) {
        candidates.push(pair);
      }
    }
  }

  let matched = 0;
  for (const entry of entries.values()) {
    let entryHasExample = false;
    for (const meaning of entry.meanings) {
      for (const sense of meaning.senses) {
        const bilingual = [];
        for (const example of sense.examples || []) {
          if (example.zh) {
            bilingual.push(example);
            continue;
          }
          const translation = pairs.get(normalise(example.en));
          if (translation) bilingual.push({ en: example.en, zh: translation });
        }
        sense.examples = bilingual.slice(0, 2);
        if (sense.examples.length) entryHasExample = true;
        matched += sense.examples.length;
      }
    }
    if (!entryHasExample && /^[a-z]+(?:['-][a-z]+)*$/i.test(entry.word)) {
      const fallback = pairsByWord.get(normalise(entry.word)) || [];
      const firstSense = entry.meanings[0]?.senses[0];
      if (firstSense && fallback.length) {
        firstSense.examples = fallback.slice(0, 2);
        matched += firstSense.examples.length;
      }
    }
  }
  return matched;
}

async function main() {
  await rm(shardDir, { recursive: true, force: true });
  await mkdir(shardDir, { recursive: true });

  const entries = new Map();
  const stream = createReadStream(inputPath);
  const input = inputPath.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
  const lines = createInterface({ input, crlfDelay: Infinity });

  let processed = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.lang_code !== "en") continue;
    const entry = mapRecord(record);
    if (!entry) continue;
    const key = normalise(entry.word);
    if (entries.has(key)) mergeEntry(entries.get(key), entry);
    else entries.set(key, entry);
    processed += 1;
  }

  for (const entry of await readLegacyEntries(legacyHtml)) {
    const key = normalise(entry.word);
    if (entries.has(key)) {
      const existing = entries.get(key);
      mergeEntry(existing, entry);
      existing.translation = entry.translation;
      existing.source = "wordaroo";
    } else {
      entries.set(key, entry);
    }
  }

  for (const entry of await readCustomEntries()) {
    const key = normalise(entry.word);
    if (!key) continue;
    entries.set(key, entry);
  }

  const taxonomyResult = await addTaxonomyEntries(entries, dinosaurPath, mossPath);
  const translationResult = await applyChineseTranslations(entries, ecdictPath);
  const bilingualExamples = await applyBilingualExamples(entries, bilingualSentencesPath);

  const shards = new Map();
  for (const [key, entry] of entries) {
    const shard = shardKey(key);
    if (!shards.has(shard)) shards.set(shard, {});
    shards.get(shard)[key] = entry;
  }

  const shardNames = [...shards.keys()].sort();
  for (const shard of shardNames) {
    const payload = JSON.stringify(shards.get(shard));
    const script = `window.WordarooDB.registerShard(${JSON.stringify(shard)},${payload});\n`;
    await writeFile(path.join(shardDir, `${shard}.js`), script);
  }

  const manifest = {
    version: new Date().toISOString().slice(0, 10),
    entryCount: entries.size,
    sourceRecordCount: processed,
    translatedEntryCount: translationResult.translated,
    ecdictAddedEntryCount: translationResult.added,
    dinosaurTaxonomyEntryCount: taxonomyResult.dinosaurAdded,
    mossTaxonomyEntryCount: taxonomyResult.mossAdded,
    bilingualExampleCount: bilingualExamples,
    shardCount: shardNames.length,
    shards: shardNames
  };
  const manifestScript = `"use strict";
(function () {
  const manifest = ${JSON.stringify(manifest)};
  const loaded = Object.create(null);
  const loading = Object.create(null);
  const normalise = (value) => String(value || "")
    .trim()
    .toLocaleLowerCase("en")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\\s+/g, " ");
  const shardKey = (word) => {
    const key = normalise(word).replace(/^[^a-z0-9]+/, "");
    if (!key) return "__";
    return (key + "___").slice(0, 3).replace(/[^a-z0-9]/g, "_");
  };
  const api = window.WordarooDB = {
    manifest,
    registerShard(name, data) {
      loaded[name] = data;
    },
    async loadShard(name) {
      if (loaded[name]) return loaded[name];
      if (!manifest.shards.includes(name)) return {};
      if (!loading[name]) {
        loading[name] = new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "data/shards/" + name + ".js";
          script.onload = () => resolve(loaded[name] || {});
          script.onerror = () => reject(new Error("Unable to load shard " + name));
          document.head.append(script);
        });
      }
      return loading[name];
    },
    async lookup(word) {
      const key = normalise(word);
      const data = await api.loadShard(shardKey(key));
      return data[key] || null;
    },
    async suggest(query, limit = 7) {
      const key = normalise(query);
      if (key.length < 2) return [];
      const shardNames = key.length >= 3
        ? [shardKey(key)]
        : manifest.shards.filter((name) => name.startsWith(key));
      const shardData = await Promise.all(shardNames.map((name) => api.loadShard(name)));
      return shardData.flatMap((data) => Object.values(data))
        .filter((entry) => normalise(entry.word).startsWith(key))
        .map((entry) => entry.word)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, limit);
    }
  };
})();
`;
  await writeFile(path.join(outputDir, "manifest.js"), manifestScript);
  console.log(
    `Built ${entries.size} entries in ${shardNames.length} shards; ` +
    `${translationResult.translated} Chinese entries, ` +
    `${translationResult.added} ECDICT additions, and ${bilingualExamples} bilingual examples.`
  );
  console.log(
    `Added ${taxonomyResult.dinosaurAdded} dinosaur taxonomy names and ` +
    `${taxonomyResult.mossAdded} Bryophyta names.`
  );
}

await main();
