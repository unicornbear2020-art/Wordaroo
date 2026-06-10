"use strict";

const db = window.WordarooDB;
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
  voiceName: document.querySelector("#voiceName")
};

let currentEntry = null;
let voices = [];
let selectedVoice = null;
let playToken = 0;
let suggestionTimer = 0;

function normalise(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
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
  elements.source.textContent =
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
      : "資料源：Wiktionary / Wiktextract（CC BY-SA 4.0 / GFDL）";

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
      elements.input.value = entry.word;
      renderEntry(entry, shouldSpeak);
      return;
    }
    const suggestions = await db.suggest(query, 5);
    showNotFound(query, suggestions);
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
    const words = await db.suggest(query, 7);
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
