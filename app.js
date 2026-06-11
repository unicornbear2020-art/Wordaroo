"use strict";

const db = window.WordarooDB;
const peopleNames = Array.isArray(window.WordarooPeopleNames)
  ? window.WordarooPeopleNames
  : [];
const disneyCharacters = Array.isArray(window.WordarooDisneyCharacters)
  ? window.WordarooDisneyCharacters
  : [];
const pixarCharacters = Array.isArray(window.WordarooPixarCharacters)
  ? window.WordarooPixarCharacters
  : [];
const customCharacters = [...pixarCharacters, ...disneyCharacters];
const preferredFemaleNames = [
  "Serena",
  "Kate",
  "Martha",
  "Libby",
  "Hazel",
  "Susan",
  "Samantha",
  "Flo",
  "Sandy",
  "Shelley",
  "Karen",
  "Matilda",
  "female"
];
const localeRegion = { "en-GB": "UK", "en-US": "US", "en-AU": "AU" };
const regionLabels = { UK: "BRITISH", US: "AMERICAN", AU: "AUSTRALIAN", GENERAL: "GENERAL" };
const storageKeys = {
  accent: "wordarooDictionaryAccent",
  voice: "wordarooDictionaryVoice",
  rate: "wordarooDictionaryRate",
  pitch: "wordarooDictionaryPitch",
  settingsVersion: "wordarooDictionarySettingsVersion"
};
const settingsVersion = "3";
const defaultAustralianVoice = "Matilda (Premium)";
const defaultAmericanVoice = "Samantha";

const elements = {
  form: document.querySelector("#searchForm"),
  input: document.querySelector("#wordInput"),
  suggestions: document.querySelector("#suggestions"),
  status: document.querySelector("#databaseStatus span:last-child"),
  welcome: document.querySelector("#welcomeCard"),
  card: document.querySelector("#entryCard"),
  notFound: document.querySelector("#notFound"),
  notFoundText: document.querySelector("#notFoundText"),
  word: document.querySelector("#resultWord"),
  translation: document.querySelector("#resultTranslation"),
  badges: document.querySelector("#regionBadges"),
  pronunciations: document.querySelector("#pronunciations"),
  meanings: document.querySelector("#meanings"),
  formsBlock: document.querySelector("#formsBlock"),
  formsList: document.querySelector("#formsList"),
  source: document.querySelector("#entrySource"),
  sound: document.querySelector("#soundButton"),
  accent: document.querySelector("#accentSelect"),
  voice: document.querySelector("#voiceSelect"),
  preview: document.querySelector("#voicePreviewButton"),
  rate: document.querySelector("#rateInput"),
  rateValue: document.querySelector("#rateValue"),
  pitch: document.querySelector("#pitchInput"),
  pitchValue: document.querySelector("#pitchValue"),
  voiceName: document.querySelector("#voiceName"),
  scanButton: document.querySelector("#scanButton"),
  scanInput: document.querySelector("#scanInput"),
  scannerPanel: document.querySelector("#scannerPanel"),
  scannerClose: document.querySelector("#scannerClose"),
  scanPreview: document.querySelector("#scanPreview"),
  scannerStatus: document.querySelector("#scannerStatus"),
  scannerProgress: document.querySelector("#scannerProgress"),
  detectedWords: document.querySelector("#detectedWords"),
  resultShell: document.querySelector("#resultShell")
};

let currentEntry = null;
let voices = [];
let selectedVoice = null;
let playToken = 0;
let suggestionTimer = 0;
let ocrWorker = null;
let scanPreviewUrl = "";

function normalise(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
}

function normaliseName(value) {
  return normalise(value).replace(/[^a-z0-9]/g, "");
}

function normaliseCharacter(value) {
  return normalise(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function nameVariants(entry) {
  return [...(entry.aliases || []), ...(entry.nicknames || [])];
}

function findPeopleName(value) {
  const exactKey = normalise(value);
  const exactName = peopleNames.find((entry) => normalise(entry.name) === exactKey);
  if (exactName) return exactName;
  const exactAlias = peopleNames.find((entry) =>
    nameVariants(entry).some((alias) => normalise(alias) === exactKey)
  );
  if (exactAlias) return exactAlias;

  const looseKey = normaliseName(value);
  if (!looseKey) return null;
  return peopleNames.find((entry) =>
    normaliseName(entry.name) === looseKey ||
    nameVariants(entry).some((alias) => normaliseName(alias) === looseKey)
  ) || null;
}

function findCanonicalPeopleName(value) {
  const exactKey = normalise(value);
  const exactName = peopleNames.find((entry) => normalise(entry.name) === exactKey);
  if (exactName) return exactName;
  const looseKey = normaliseName(value);
  if (!looseKey) return null;
  return peopleNames.find((entry) => normaliseName(entry.name) === looseKey) || null;
}

function disneyVariants(entry) {
  return [
    entry.headword,
    ...(entry.aliases || []),
    ...String(entry.chinese || "").split(/[；;、,，/]/)
  ].filter(Boolean);
}

function findDisneyCharacter(value) {
  const key = normaliseCharacter(value);
  if (!key) return null;
  const exactHeadword = customCharacters.find(
    (entry) => normaliseCharacter(entry.headword) === key
  );
  if (exactHeadword) return exactHeadword;
  return customCharacters.find((entry) =>
    disneyVariants(entry)
      .slice(1)
      .some((variant) => normaliseCharacter(variant) === key)
  ) || null;
}

function disneyCharacterEntry(record) {
  return {
    word: record.headword,
    translation: record.chinese || "",
    regions: [],
    pronunciations: { UK: [], US: [], AU: [], OTHER: [] },
    meanings: [{
      pos: record.category || "Disney character",
      senses: [{
        gloss: record.shortDescription,
        glossZh: `角色出自《${record.sourceTitle}》。`,
        labels: record.tags || ["Disney", "character", record.sourceTitle],
        examples: []
      }]
    }],
    forms: (record.aliases || []).map((alias) => ({ form: alias, tags: ["alias"] })),
    source: record.category === "Disney Pixar character"
      ? "pixar-characters"
      : "disney-characters"
  };
}

function enrichWithDisneyCharacter(dictionaryEntry, record) {
  const disneyEntry = disneyCharacterEntry(record);
  const forms = [...(dictionaryEntry.forms || [])];
  for (const form of disneyEntry.forms) {
    if (!forms.some((existing) => normalise(existing.form) === normalise(form.form))) {
      forms.push(form);
    }
  }
  return {
    ...dictionaryEntry,
    word: record.headword,
    translation: disneyEntry.translation || dictionaryEntry.translation,
    meanings: [...dictionaryEntry.meanings, ...disneyEntry.meanings],
    forms,
    disneyCharacterSource: disneyEntry.source
  };
}

function peopleNameEntry(record) {
  const aliases = record.aliases || [];
  const nicknames = record.nicknames || [];
  return {
    word: record.name,
    translation: record.traditionalChineseTransliteration || "",
    regions: [],
    pronunciations: {
      UK: [],
      US: [],
      AU: [],
      OTHER: record.ipa ? [record.ipa] : []
    },
    meanings: [{
      pos: record.type || "name",
      senses: [{
        gloss: record.note || `${record.name} is used as a personal name.`,
        glossZh:
          `來源語言：${record.originLanguage || "未註明"}。` +
          (record.traditionalChineseTransliteration
            ? `繁體中文音譯：${record.traditionalChineseTransliteration}。`
            : ""),
        labels: [
          record.type,
          record.originLanguage,
          "people name"
        ].filter(Boolean),
        examples: []
      }]
    }],
    forms: [
      ...aliases.map((alias) => ({ form: alias, tags: ["alias"] })),
      ...nicknames.map((nickname) => ({ form: nickname, tags: ["nickname"] }))
    ],
    source: "people-names",
    nameDetails: {
      pronunciationGuide: record.pronunciationGuide || "",
      cantoneseHint: record.cantoneseHint || ""
    }
  };
}

function enrichWithPeopleName(dictionaryEntry, record) {
  const nameEntry = peopleNameEntry(record);
  const pronunciation = {
    UK: [...(dictionaryEntry.pronunciations.UK || [])],
    US: [...(dictionaryEntry.pronunciations.US || [])],
    AU: [...(dictionaryEntry.pronunciations.AU || [])],
    OTHER: [...new Set([
      ...(dictionaryEntry.pronunciations.OTHER || []),
      ...(nameEntry.pronunciations.OTHER || [])
    ])]
  };
  const forms = [...(dictionaryEntry.forms || [])];
  for (const form of nameEntry.forms) {
    if (!forms.some((existing) => normalise(existing.form) === normalise(form.form))) {
      forms.push(form);
    }
  }
  return {
    ...dictionaryEntry,
    word: record.name,
    translation: nameEntry.translation || dictionaryEntry.translation,
    pronunciations: pronunciation,
    meanings: [...dictionaryEntry.meanings, ...nameEntry.meanings],
    forms,
    nameDetails: nameEntry.nameDetails,
    peopleNameSource: true
  };
}

function estimatedNameEntry(value) {
  const speechAvailable = "speechSynthesis" in window;
  return {
    word: value,
    translation: "可能的人名",
    regions: [],
    pronunciations: { UK: [], US: [], AU: [], OTHER: [] },
    meanings: [{
      pos: "possible name",
      senses: [{
        gloss: "This name is not in the dictionary yet. Pronunciation may vary.",
        glossZh: "此名稱尚未收錄於字典，實際讀音可能因語言、地區或個人偏好而不同。",
        labels: ["estimated pronunciation", "possible name"],
        examples: []
      }]
    }],
    forms: [],
    source: "estimated-name",
    nameDetails: {
      pronunciationGuide: speechAvailable
        ? "Use the Speak button for a browser-generated estimate."
        : "Browser speech synthesis is unavailable.",
      cantoneseHint: "未有可靠粵語讀音提示"
    }
  };
}

function suggestPeopleNames(value, limit = 7) {
  const key = normaliseName(value);
  if (key.length < 2) return [];
  return peopleNames
    .filter((entry) =>
      normaliseName(entry.name).startsWith(key) ||
      nameVariants(entry).some((alias) => normaliseName(alias).startsWith(key))
    )
    .map((entry) => entry.name)
    .filter((name, index, names) => names.indexOf(name) === index)
    .slice(0, limit);
}

function suggestDisneyCharacters(value, limit = 7) {
  const key = normaliseCharacter(value);
  if (key.length < 2) return [];
  return customCharacters
    .filter((entry) =>
      disneyVariants(entry).some((variant) => normaliseCharacter(variant).startsWith(key))
    )
    .map((entry) => entry.headword)
    .filter((name, index, names) => names.indexOf(name) === index)
    .slice(0, limit);
}

function readSetting(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch (error) {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch (error) {
    // The dictionary remains usable if file storage is blocked.
  }
}

function priorityIndex(voice) {
  const name = voice.name.toLowerCase();
  const index = preferredFemaleNames.findIndex((candidate) =>
    name.includes(candidate.toLowerCase())
  );
  return index === -1 ? preferredFemaleNames.length : index;
}

function chooseVoice() {
  if (!("speechSynthesis" in window)) return;
  voices = window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith("en"));

  const locale = elements.accent.value;
  const savedName = readSetting(
    `${storageKeys.voice}:${locale}`,
    locale === "en-US"
      ? defaultAmericanVoice
      : locale === "en-AU"
        ? defaultAustralianVoice
        : ""
  );
  const localeVoices = voices
    .filter((voice) => voice.lang.toLowerCase().startsWith(locale.toLowerCase()))
    .sort((a, b) => priorityIndex(a) - priorityIndex(b) || a.name.localeCompare(b.name));
  const englishVoices = voices
    .slice()
    .sort((a, b) => priorityIndex(a) - priorityIndex(b) || a.name.localeCompare(b.name));

  selectedVoice =
    voices.find((voice) => voice.name === savedName) ||
    localeVoices[0] ||
    englishVoices[0] ||
    null;

  elements.voice.replaceChildren();
  const ordered = [...localeVoices, ...englishVoices.filter((voice) => !localeVoices.includes(voice))];
  if (!ordered.length) {
    const option = document.createElement("option");
    option.textContent = "裝置預設聲音";
    option.value = "";
    elements.voice.append(option);
    elements.voice.disabled = true;
  } else {
    elements.voice.disabled = false;
    ordered.forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.name;
      option.textContent = `${voice.name} (${voice.lang})`;
      option.selected = selectedVoice && voice.name === selectedVoice.name;
      elements.voice.append(option);
    });
  }
  elements.voiceName.textContent = selectedVoice
    ? `使用聲音：${selectedVoice.name}（${selectedVoice.lang}）`
    : "使用聲音：裝置預設聲音";
}

function stopSpeaking() {
  playToken += 1;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  elements.sound.classList.remove("speaking");
}

function speak(text, repetitions = 1, markButton = true) {
  if (!text || !("speechSynthesis" in window)) return;
  stopSpeaking();
  chooseVoice();
  const token = playToken;
  if (markButton) elements.sound.classList.add("speaking");

  const playNext = (remaining) => {
    if (token !== playToken || remaining <= 0) {
      elements.sound.classList.remove("speaking");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = elements.accent.value;
    utterance.rate = Number(elements.rate.value) || 0.88;
    utterance.pitch = Number(elements.pitch.value) || 1.12;
    utterance.volume = 1;
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.onend = () => {
      if (remaining > 1 && token === playToken) {
        window.setTimeout(() => playNext(remaining - 1), 1000);
      } else {
        elements.sound.classList.remove("speaking");
      }
    };
    utterance.onerror = () => elements.sound.classList.remove("speaking");
    window.speechSynthesis.speak(utterance);
  };

  playNext(repetitions);
}

function ocrAssetUrl(path) {
  return new URL(path, document.baseURI).href;
}

function updateOcrProgress(message) {
  const labels = {
    "loading tesseract core": "正在載入文字辨識引擎...",
    "initializing tesseract": "正在啟動文字辨識...",
    "loading language traineddata": "正在載入英文辨識資料...",
    "initializing api": "正在準備掃描...",
    "recognizing text": "正在辨識相片文字..."
  };
  const progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
  elements.scannerStatus.textContent = labels[message.status] || "正在處理相片...";
  elements.scannerProgress.value = Math.round(progress * 100);
}

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) throw new Error("Tesseract.js is unavailable.");
  ocrWorker = await window.Tesseract.createWorker("eng", window.Tesseract.OEM.LSTM_ONLY, {
    workerPath: ocrAssetUrl("vendor/tesseract/worker.min.js"),
    corePath: ocrAssetUrl("vendor/tesseract/core"),
    langPath: ocrAssetUrl("vendor/tesseract/lang"),
    logger: updateOcrProgress
  });
  return ocrWorker;
}

function prepareOcrImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
      if (longestSide <= 2200) {
        resolve(file);
        return;
      }
      const scale = 2200 / longestSide;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext("2d", { alpha: false });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected image could not be opened."));
    };
    image.src = objectUrl;
  });
}

function extractDetectedWords(text) {
  const matches = String(text || "").match(/[A-Za-z]+(?:[’'-][A-Za-z]+)*/g) || [];
  const seen = new Set();
  return matches
    .map((word) => word.replace(/[’'-]+$/g, ""))
    .filter((word) => {
      const key = word.toLocaleLowerCase("en");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}

function renderDetectedWords(words) {
  elements.detectedWords.replaceChildren();
  words.forEach((word) => {
    const group = document.createElement("span");
    group.className = "detected-word";

    const searchButton = document.createElement("button");
    searchButton.type = "button";
    searchButton.className = "detected-word-search";
    searchButton.textContent = word;
    searchButton.setAttribute("aria-label", `搜尋 ${word}`);
    searchButton.addEventListener("click", () => {
      searchWord(word);
      elements.resultShell.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    const speakButton = document.createElement("button");
    speakButton.type = "button";
    speakButton.className = "detected-word-speak";
    speakButton.textContent = "聽";
    speakButton.setAttribute("aria-label", `讀出 ${word}`);
    speakButton.addEventListener("click", () => speak(word, 1, false));

    group.append(searchButton, speakButton);
    elements.detectedWords.append(group);
  });
}

async function scanImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    elements.scannerStatus.textContent = "請選擇相片檔案。";
    return;
  }
  elements.scannerPanel.hidden = false;
  elements.detectedWords.replaceChildren();
  elements.scannerProgress.hidden = false;
  elements.scannerProgress.value = 0;
  elements.scannerStatus.textContent = "正在準備相片...";
  elements.scanButton.disabled = true;

  if (scanPreviewUrl) URL.revokeObjectURL(scanPreviewUrl);
  scanPreviewUrl = URL.createObjectURL(file);
  elements.scanPreview.src = scanPreviewUrl;
  elements.scanPreview.hidden = false;

  try {
    const image = await prepareOcrImage(file);
    const worker = await getOcrWorker();
    const result = await worker.recognize(image);
    const words = extractDetectedWords(result.data.text);
    renderDetectedWords(words);
    elements.scannerStatus.textContent = words.length
      ? `偵測到 ${words.length} 個不同英文詞。點按詞語查字，或按喇叭試聽。`
      : "未能偵測到清晰英文文字，請嘗試光線較好及文字較正面的相片。";
  } catch (error) {
    console.error("OCR scan failed:", error);
    elements.scannerStatus.textContent =
      location.protocol === "file:"
        ? "瀏覽器封鎖了本機 OCR 檔案。請用 GitHub Pages 或本機 HTTP 伺服器開啟。"
        : "文字掃描失敗，請重新選擇較清晰的相片。";
  } finally {
    elements.scannerProgress.hidden = true;
    elements.scanButton.disabled = false;
    elements.scanInput.value = "";
  }
}

function createBadge(region) {
  const badge = document.createElement("span");
  badge.className = `region-badge ${region.toLowerCase()}`;
  badge.textContent = regionLabels[region] || region;
  return badge;
}

function renderPronunciations(entry) {
  elements.pronunciations.replaceChildren();
  const order = ["UK", "US", "AU", "OTHER"];
  order.forEach((region) => {
    const values = entry.pronunciations[region] || [];
    if (!values.length) return;
    const row = document.createElement("div");
    row.className = "pronunciation";
    const label = document.createElement("strong");
    label.textContent = region === "OTHER" ? "IPA" : region;
    const value = document.createElement("span");
    value.textContent = values.join(" · ");
    row.append(label, value);
    elements.pronunciations.append(row);
  });
  if (entry.nameDetails?.pronunciationGuide) {
    const row = document.createElement("div");
    row.className = "pronunciation";
    const label = document.createElement("strong");
    label.textContent = "GUIDE";
    const value = document.createElement("span");
    value.textContent = entry.nameDetails.pronunciationGuide;
    row.append(label, value);
    elements.pronunciations.append(row);
  }
  if (entry.nameDetails?.cantoneseHint) {
    const row = document.createElement("div");
    row.className = "pronunciation";
    const label = document.createElement("strong");
    label.textContent = "粵語";
    const value = document.createElement("span");
    value.textContent = entry.nameDetails.cantoneseHint;
    row.append(label, value);
    elements.pronunciations.append(row);
  }
}

function renderMeanings(entry) {
  elements.meanings.replaceChildren();
  entry.meanings.forEach((meaning) => {
    const section = document.createElement("section");
    section.className = "meaning";
    const heading = document.createElement("h3");
    heading.textContent = meaning.pos || "word";
    const list = document.createElement("ol");
    list.className = "sense-list";

    meaning.senses.forEach((sense) => {
      const item = document.createElement("li");
      if (sense.labels && sense.labels.length) {
        const labels = document.createElement("div");
        labels.className = "sense-labels";
        sense.labels.forEach((text) => {
          const label = document.createElement("span");
          label.className = "sense-label";
          label.textContent = text;
          labels.append(label);
        });
        item.append(labels);
      }
      const gloss = document.createElement("div");
      gloss.textContent = sense.gloss;
      item.append(gloss);
      if (sense.glossZh) {
        const glossZh = document.createElement("p");
        glossZh.className = "gloss-zh";
        glossZh.textContent = sense.glossZh;
        item.append(glossZh);
      }
      (sense.examples || []).slice(0, 2).forEach((exampleData) => {
        const examplePair =
          typeof exampleData === "string" ? { en: exampleData, zh: "" } : exampleData;
        const example = document.createElement("p");
        example.className = "example";
        const english = document.createElement("span");
        english.textContent = examplePair.en;
        example.append(english);
        if (examplePair.zh) {
          const chinese = document.createElement("span");
          chinese.className = "example-zh";
          chinese.textContent = examplePair.zh;
          example.append(chinese);
        }
        item.append(example);
      });
      list.append(item);
    });

    section.append(heading, list);
    elements.meanings.append(section);
  });
}

function renderEntry(entry, shouldSpeak = true) {
  currentEntry = entry;
  elements.welcome.hidden = true;
  elements.notFound.hidden = true;
  elements.card.hidden = false;
  elements.word.textContent = entry.word;
  elements.sound.setAttribute("aria-label", `讀出 ${entry.word}`);
  elements.translation.textContent = entry.translation || "";
  elements.translation.hidden = !entry.translation;

  elements.badges.replaceChildren();
  const regions = entry.regions && entry.regions.length ? entry.regions : ["GENERAL"];
  regions.forEach((region) => elements.badges.append(createBadge(region)));
  renderPronunciations(entry);
  renderMeanings(entry);

  elements.formsList.replaceChildren();
  (entry.forms || []).slice(0, 24).forEach((form) => {
    const chip = document.createElement("span");
    chip.className = "form-chip";
    chip.textContent = form.tags && form.tags.length
      ? `${form.form} · ${form.tags.join(", ")}`
      : form.form;
    elements.formsList.append(chip);
  });
  elements.formsBlock.hidden = !elements.formsList.childElementCount;
  const sourceText =
    entry.source === "wordaroo"
      ? "Wordaroo 編輯詞條"
      : entry.source === "ecdict"
        ? "資料源：ECDICT（MIT License）"
        : entry.source === "pbdb"
          ? "分類資料源：Paleobiology Database（Dinosauria）"
          : entry.source === "gbif"
            ? "分類資料源：GBIF Backbone Taxonomy（CC BY 4.0）"
          : entry.source === "pokeapi"
            ? "名稱資料源：PokéAPI（全國圖鑑）"
          : entry.source === "people-names"
            ? "人名資料：Wordaroo People Names"
          : entry.source === "disney-characters"
            ? "角色資料：Wordaroo Disney Character Dictionary"
          : entry.source === "pixar-characters"
            ? "角色資料：Wordaroo Disney/Pixar Character Dictionary"
          : entry.source === "estimated-name"
            ? "瀏覽器語音估算；讀音可能因人而異"
      : "資料源：Wiktionary / Wiktextract（CC BY-SA 4.0 / GFDL）";
  const sourceLabels = [sourceText];
  if (entry.peopleNameSource) sourceLabels.push("人名資料：Wordaroo People Names");
  if (entry.disneyCharacterSource === "pixar-characters") {
    sourceLabels.push("角色資料：Wordaroo Disney/Pixar Character Dictionary");
  } else if (entry.disneyCharacterSource) {
    sourceLabels.push("角色資料：Wordaroo Disney Character Dictionary");
  }
  elements.source.textContent = sourceLabels.join(" · ");

  if (shouldSpeak) speak(entry.word, 2);
}

function showNotFound(query, suggestions = []) {
  stopSpeaking();
  currentEntry = null;
  elements.welcome.hidden = true;
  elements.card.hidden = true;
  elements.notFound.hidden = false;
  elements.notFoundText.replaceChildren(
    document.createTextNode(`離線資料庫暫時未有「${query}」。`)
  );
  if (suggestions.length) {
    elements.notFoundText.append(document.createTextNode(` 你可能想查：${suggestions.join("、")}`));
  }
}

async function searchWord(value, shouldSpeak = true) {
  const query = String(value || "").trim();
  if (!query) {
    elements.input.focus();
    return;
  }
  elements.input.value = query;
  elements.suggestions.hidden = true;
  try {
    const entry = await db.lookup(query);
    if (entry) {
      const person = findCanonicalPeopleName(query);
      const disneyCharacter = findDisneyCharacter(query);
      let result = person ? enrichWithPeopleName(entry, person) : entry;
      if (disneyCharacter) result = enrichWithDisneyCharacter(result, disneyCharacter);
      elements.input.value = result.word;
      renderEntry(result, shouldSpeak);
      return;
    }
    const disneyCharacter = findDisneyCharacter(query);
    if (disneyCharacter) {
      const result = disneyCharacterEntry(disneyCharacter);
      elements.input.value = result.word;
      renderEntry(result, shouldSpeak);
      return;
    }
    const person = findPeopleName(query);
    if (person) {
      const result = peopleNameEntry(person);
      elements.input.value = result.word;
      renderEntry(result, shouldSpeak);
      return;
    }
    renderEntry(estimatedNameEntry(query), shouldSpeak);
  } catch (error) {
    showNotFound(query);
    elements.notFoundText.textContent = "資料分片無法載入。請保持整個 Wordaroo-Dictionary 資料夾結構不變。";
  }
}

async function updateSuggestions() {
  const query = elements.input.value.trim();
  if (normalise(query).length < 2) {
    elements.suggestions.hidden = true;
    return;
  }
  try {
    const dictionaryWords = await db.suggest(query, 7);
    const words = [
      ...dictionaryWords.slice(0, 4),
      ...suggestPeopleNames(query),
      ...suggestDisneyCharacters(query)
    ]
      .filter((word, index, values) => values.indexOf(word) === index)
      .slice(0, 7);
    elements.suggestions.replaceChildren();
    words.forEach((word) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = word;
      button.addEventListener("click", () => searchWord(word));
      elements.suggestions.append(button);
    });
    elements.suggestions.hidden = !words.length;
  } catch (error) {
    elements.suggestions.hidden = true;
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  searchWord(elements.input.value);
});

elements.input.addEventListener("input", () => {
  window.clearTimeout(suggestionTimer);
  suggestionTimer = window.setTimeout(updateSuggestions, 130);
});

elements.sound.addEventListener("click", () => {
  if (currentEntry) speak(currentEntry.word, 1);
});

elements.preview.addEventListener("click", () => speak("adventure", 1, false));

elements.accent.addEventListener("change", () => {
  saveSetting(storageKeys.accent, elements.accent.value);
  stopSpeaking();
  chooseVoice();
});

elements.voice.addEventListener("change", () => {
  selectedVoice = voices.find((voice) => voice.name === elements.voice.value) || null;
  if (selectedVoice) {
    saveSetting(`${storageKeys.voice}:${elements.accent.value}`, selectedVoice.name);
  }
  stopSpeaking();
  chooseVoice();
});

elements.rate.addEventListener("input", () => {
  elements.rateValue.value = Number(elements.rate.value).toFixed(2);
  saveSetting(storageKeys.rate, elements.rate.value);
});

elements.pitch.addEventListener("input", () => {
  elements.pitchValue.value = Number(elements.pitch.value).toFixed(2);
  saveSetting(storageKeys.pitch, elements.pitch.value);
});

document.querySelectorAll("[data-word]").forEach((button) => {
  button.addEventListener("click", () => searchWord(button.dataset.word));
});

elements.scanButton.addEventListener("click", () => elements.scanInput.click());
elements.scanInput.addEventListener("change", () => scanImage(elements.scanInput.files[0]));
elements.scannerClose.addEventListener("click", () => {
  elements.scannerPanel.hidden = true;
});

if (readSetting(storageKeys.settingsVersion, "") !== settingsVersion) {
  saveSetting(storageKeys.accent, "en-US");
  saveSetting(`${storageKeys.voice}:en-US`, defaultAmericanVoice);
  saveSetting(`${storageKeys.voice}:en-AU`, defaultAustralianVoice);
  saveSetting(storageKeys.settingsVersion, settingsVersion);
}
elements.accent.value = readSetting(storageKeys.accent, "en-US");
elements.rate.value = readSetting(storageKeys.rate, "0.88");
elements.pitch.value = readSetting(storageKeys.pitch, "1.12");
elements.rateValue.value = Number(elements.rate.value).toFixed(2);
elements.pitchValue.value = Number(elements.pitch.value).toFixed(2);
elements.status.textContent = `${db.manifest.entryCount.toLocaleString()} 個離線詞條`;

chooseVoice();
if ("speechSynthesis" in window) {
  if (window.speechSynthesis.addEventListener) {
    window.speechSynthesis.addEventListener("voiceschanged", chooseVoice);
  } else {
    window.speechSynthesis.onvoiceschanged = chooseVoice;
  }
}
